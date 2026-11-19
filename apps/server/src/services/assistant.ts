import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CharacterPublic,
  ChatMemberPublic,
  MemoryPublic,
  MessagePublic,
  StickerPublic,
} from '@inkmate/shared';
import { getCharacter } from '../db/characters.js';
import {
  getChatMembers,
  getChatRow,
  getLastAssistantMessage,
  getRecentMessages,
  insertMessage,
  touchChat,
} from '../db/chats.js';
import { getMemory } from '../db/memory.js';
import { getWorldEntriesForCharacter, type InjectedWorldEntry } from '../db/world-books.js';
import { HttpError } from '../lib/http-error.js';
import { buildChatMessages, buildGroupMessages } from '../llm/prompt.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';
import { streamChat } from '../llm/stream.js';
import { maybeSummarize } from './memory.js';
import { getScheduleContext } from './schedule.js';
import { getWeatherText } from './weather.js';
import { listStickers, stickersForPrompt } from './stickers.js';

const STICKER_LINE = /^\s*\[(?:表情|sticker)\s*[:：]\s*(.+?)\]\s*$/i;

/** 把「[表情:猫猫得意]」这种标记换成要发的表情包，其余留给文字 */
function parseStickerReply(
  raw: string,
  stickers: StickerPublic[],
): { text: string; stickers: StickerPublic[] } {
  const textLines: string[] = [];
  const picked: StickerPublic[] = [];
  for (const line of raw.split('\n')) {
    const match = STICKER_LINE.exec(line);
    if (!match) {
      textLines.push(line);
      continue;
    }
    const desc = match[1]?.trim() ?? '';
    const found =
      stickers.find((item) => item.desc && item.desc === desc) ??
      stickers.find(
        (item) => item.desc && (item.desc.includes(desc) || desc.includes(item.desc)),
      );
    if (found) picked.push(found);
  }
  // 行内残留的标记直接去掉，避免直接念给用户看
  const text = textLines
    .join('\n')
    .replace(/\[(?:表情|sticker)\s*[:：][^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, stickers: picked };
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function event(reply: FastifyReply, name: string, data: unknown): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 群聊选人：优先 @/点名，其次按上一个发言者轮转。 */
export function selectGroupSpeaker(
  chatId: string,
  members: ChatMemberPublic[],
  userText: string,
  preferredId?: string,
): ChatMemberPublic {
  if (members.length === 0) throw new HttpError(400, '群聊没有成员');

  if (preferredId) {
    const preferred = members.find((member) => member.characterId === preferredId);
    if (preferred) return preferred;
  }

  const text = userText.trim();
  if (text) {
    for (const member of members) {
      const names = [member.nickname.trim(), member.name.trim()].filter(
        (name) => name.length >= 2,
      );
      if (names.some((name) => text.includes(name))) return member;
    }
  }

  const last = getLastAssistantMessage(chatId);
  if (last) {
    const index = members.findIndex((member) => member.characterId === last.senderId);
    if (index >= 0) return members[(index + 1) % members.length] ?? members[0]!;
  }
  return members[0]!;
}

function groupWorldEntries(members: ChatMemberPublic[]): InjectedWorldEntry[] {
  const seen = new Set<string>();
  const result: InjectedWorldEntry[] = [];
  for (const member of members) {
    for (const entry of getWorldEntriesForCharacter(member.characterId)) {
      const key = `${entry.bookName}\u0000${entry.title}\u0000${entry.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
      if (result.length >= 12) return result;
    }
  }
  return result;
}

export function resolveAssistantTarget(options: {
  chatId: string;
  userText: string;
  speakerId?: string;
}): { chat: ReturnType<typeof getChatRow>; character: CharacterPublic; member: ChatMemberPublic | null } {
  const chat = getChatRow(options.chatId);
  if (!chat) throw new HttpError(404, '会话不存在');
  if (chat.kind === 'group') {
    const members = getChatMembers(options.chatId);
    const member = selectGroupSpeaker(options.chatId, members, options.userText, options.speakerId);
    const character = getCharacter(member.characterId);
    if (!character) throw new HttpError(404, '群成员角色不存在');
    resolveProviderForCharacter(character);
    return { chat, character, member };
  }
  if (!chat.character_id) throw new HttpError(400, '该会话没有绑定角色');
  const character = getCharacter(chat.character_id);
  if (!character) throw new HttpError(404, '角色不存在');
  resolveProviderForCharacter(character);
  return { chat, character, member: null };
}

export async function streamAssistantReply(options: {
  request: FastifyRequest;
  reply: FastifyReply;
  chatId: string;
  userMessage?: MessagePublic;
  /** 连发多条时，把这一批用户消息一起告诉前端 */
  userMessages?: MessagePublic[];
  userText?: string;
  speakerId?: string;
}): Promise<void> {
  const { request, reply, chatId, userMessage, userMessages } = options;
  if (!request.user) throw new HttpError(401, '未登录');
  const chat = getChatRow(chatId);
  if (!chat) throw new HttpError(404, '会话不存在');

  const isGroup = chat.kind === 'group';
  const members = isGroup ? getChatMembers(chatId) : [];
  let character: CharacterPublic;
  let speaker: ChatMemberPublic | null = null;
  let worldEntries: InjectedWorldEntry[];
  let memory: MemoryPublic | null = null;
  let schedule: ReturnType<typeof getScheduleContext> = null;

  if (isGroup) {
    if (members.length < 2) throw new HttpError(400, '群聊成员不足');
    speaker = selectGroupSpeaker(chatId, members, options.userText ?? '', options.speakerId);
    const found = getCharacter(speaker.characterId);
    if (!found) throw new HttpError(404, '群成员角色不存在');
    character = found;
    worldEntries = groupWorldEntries(members);
  } else {
    if (!chat.character_id) throw new HttpError(400, '该会话没有绑定角色');
    const found = getCharacter(chat.character_id);
    if (!found) throw new HttpError(404, '角色不存在');
    character = found;
    worldEntries = getWorldEntriesForCharacter(character.id);
    memory = getMemory(chatId);
    schedule = getScheduleContext(character.id);
  }

  const config = resolveProviderForCharacter(character);
  const history = getRecentMessages(chatId, character.memoryLimit || 40);
  // 会话里可以给「我」单独设一套名字和人设；没设就沿用全局
  const identity = {
    name: (chat.user_name ?? '').trim(),
    persona: (chat.user_persona ?? '').trim(),
  };
  const weather = await getWeatherText();
  const stickerLibrary = stickersForPrompt();
  const messages = isGroup
    ? buildGroupMessages({
        title: chat.title,
        speaker: speaker!,
        members,
        user: request.user,
        identity,
        history,
        worldEntries,
        weather,
        stickers: stickerLibrary,
      })
    : buildChatMessages({
        character,
        user: request.user,
        identity,
        history,
        worldEntries,
        memory: memory ?? undefined,
        schedule: schedule ?? undefined,
        weather,
        stickers: stickerLibrary,
      });

  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  reply.raw.flushHeaders();

  const controller = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.on('close', onClose);

  event(reply, 'start', {
    createdAt: Date.now(),
    userMessage: userMessage ?? null,
    userMessages: userMessages ?? (userMessage ? [userMessage] : []),
    speaker: speaker,
  });

  let content = '';
  let saved: MessagePublic | null = null;
  try {
    for await (const delta of streamChat(config, messages, controller.signal)) {
      content += delta;
      event(reply, 'delta', { text: delta });
    }

    const parsed = parseStickerReply(content.trim(), listStickers());
    if (!parsed.text && parsed.stickers.length === 0) {
      throw new HttpError(502, '模型没有返回内容');
    }

    const savedMessages: MessagePublic[] = [];
    // 同一毫秒插入的多条消息要保证顺序：文字在前、表情在后
    let stamp = Date.now();
    if (parsed.text) {
      const textMessage = insertMessage({
        chatId,
        role: 'assistant',
        senderId: character.id,
        kind: 'text',
        content: parsed.text,
        createdAt: stamp,
      });
      stamp += 1;
      savedMessages.push(textMessage);
      saved = textMessage;
      event(reply, 'message', { message: textMessage });
    }
    for (const sticker of parsed.stickers) {
      const imageMessage = insertMessage({
        chatId,
        role: 'assistant',
        senderId: character.id,
        kind: 'image',
        content: sticker.url,
        createdAt: stamp,
      });
      stamp += 1;
      savedMessages.push(imageMessage);
      saved = imageMessage;
      event(reply, 'message', { message: imageMessage });
    }

    touchChat(chatId, 1);
    event(reply, 'done', { message: saved, messages: savedMessages });
    if (!isGroup) maybeSummarize(chatId);
  } catch (error) {
    const aborted = controller.signal.aborted || reply.raw.destroyed;
    const message = error instanceof HttpError ? error.message : '生成失败，请稍后重试';
    const text = content.trim();

    if (text) {
      saved = insertMessage({
        chatId,
        role: 'assistant',
        senderId: character.id,
        kind: 'text',
        content: text,
        meta: aborted ? { interrupted: true } : { error: message },
      });
      touchChat(chatId, 1);
      if (!isGroup) maybeSummarize(chatId);
    }

    if (!aborted) {
      if (saved) {
        event(reply, 'done', { message: saved, interrupted: true, error: message });
      } else {
        event(reply, 'error', { error: message });
      }
    }
  } finally {
    reply.raw.off('close', onClose);
    if (!reply.raw.writableEnded) reply.raw.end();
  }
}
