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
  hardDeleteMessage,
  insertMessage,
  touchChat,
} from '../db/chats.js';
import { getMemory } from '../db/memory.js';
import { createPromise, listUpcomingPromises } from '../db/promises.js';
import { addAgendaItem, listAgenda } from '../db/agenda.js';
import { getWorldEntriesForCharacter, type InjectedWorldEntry } from '../db/world-books.js';
import { HttpError } from '../lib/http-error.js';
import { buildChatMessages, buildGroupMessages } from '../llm/prompt.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';
import { streamChat } from '../llm/stream.js';
import { maybeSummarize } from './memory.js';
import { getWeatherText } from './weather.js';
import { listStickers, stickersForPrompt } from './stickers.js';

const STICKER_LINE = /^\s*\[(?:表情|sticker)\s*[:：]\s*(.+?)\]\s*$/i;

type ReplyPart =
  | { type: 'text'; content: string }
  | { type: 'sticker'; url: string; desc: string }
  | { type: 'descImage'; content: string }
  | { type: 'voice'; content: string; seconds: number }
  | { type: 'packet'; content: string; amount: number }
  | { type: 'promise'; dueAt: number; note: string }
  | { type: 'agenda'; content: string };

const IMAGE_LINE = /^\s*\[(?:图片|图像|照片|image)\s*[:：]\s*(.+?)\]\s*$/i;
const VOICE_LINE = /^\s*\[(?:语音|voice)\s*[:：]\s*(.*?)\]\s*$/i;
const PACKET_LINE = /^\s*\[(?:红包|red-?packet)\s*[:：]\s*(.+?)\]\s*$/i;
const PROMISE_LINE = /^\s*\[(?:约|约定|提醒|remind)\s*[:：]\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*([^\]]*?)\]\s*$/i;
const AGENDA_LINE = /^\s*\[(?:日程|安排|agenda)\s*[:：]\s*(.+?)\]\s*$/i;

/** 模型有时会把历史里的「[时间]」抄进回复，这里清掉，别让它显示成假的时间戳 */
function stripTimeMarkers(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\[\d{1,2}:\d{2}\]\s*/, '')
        .replace(/^\s*\[\s*\d{1,2}\s*月\s*\d{1,2}\s*日[^\]]*\]\s*/, '')
        .replace(/（距上一条[^）]*）/g, '')
        .replace(/\(距上一条[^)]*\)/g, '')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function todayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 约定时间：今天该时刻还没到就今天，过了就明天 */
function nextDueAt(hour: number, minute: number): number {
  const due = new Date();
  due.setHours(Math.min(23, Math.max(0, hour)), Math.min(59, Math.max(0, minute)), 0, 0);
  if (due.getTime() <= Date.now()) due.setDate(due.getDate() + 1);
  return due.getTime();
}

/** 没有真音频，按字数估个时长（中文大概 4 字/秒） */
function estimateSeconds(text: string): number {
  return Math.max(1, Math.min(60, Math.round(text.length / 4) || 1));
}

/**
 * 模型看不到真图片，用文字替身：
 * - [表情:描述] 换成表情包库里的图
 * - [图片:描述] 变成一张“文字图”（这个角色描述的画面）
 * 其余行按顺序保留成文字气泡。
 */
function parseReply(raw: string, stickers: StickerPublic[]): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    buffer = [];
    if (text) parts.push({ type: 'text', content: text });
  };

  for (const line of raw.split('\n')) {
    const stickerMatch = STICKER_LINE.exec(line);
    if (stickerMatch) {
      const desc = stickerMatch[1]?.trim() ?? '';
      const found =
        stickers.find((item) => item.desc && item.desc === desc) ??
        stickers.find(
          (item) => item.desc && (item.desc.includes(desc) || desc.includes(item.desc)),
        );
      if (found) {
        flush();
        parts.push({ type: 'sticker', url: found.url, desc: found.desc.trim() });
      }
      continue;
    }
    const imageMatch = IMAGE_LINE.exec(line);
    if (imageMatch) {
      flush();
      parts.push({ type: 'descImage', content: imageMatch[1]?.trim() ?? '' });
      continue;
    }
    const voiceMatch = VOICE_LINE.exec(line);
    if (voiceMatch) {
      const said = voiceMatch[1]?.trim() ?? '';
      flush();
      parts.push({ type: 'voice', content: said, seconds: estimateSeconds(said) });
      continue;
    }
    const packetMatch = PACKET_LINE.exec(line);
    if (packetMatch) {
      const raw = packetMatch[1]?.trim() ?? '';
      const amountMatch = /^(\d+(?:\.\d+)?)\s*(.*)$/.exec(raw);
      flush();
      parts.push({
        type: 'packet',
        amount: amountMatch ? Number(amountMatch[1]) : 0,
        content: amountMatch ? (amountMatch[2] ?? '').trim() : raw,
      });
      continue;
    }
    const promiseMatch = PROMISE_LINE.exec(line);
    if (promiseMatch) {
      const hour = Number(promiseMatch[1]);
      const minute = Number(promiseMatch[2]);
      flush();
      parts.push({
        type: 'promise',
        dueAt: nextDueAt(hour, minute),
        note: (promiseMatch[3] ?? '').trim(),
      });
      continue;
    }
    const agendaMatch = AGENDA_LINE.exec(line);
    if (agendaMatch) {
      flush();
      parts.push({ type: 'agenda', content: (agendaMatch[1] ?? '').trim() });
      continue;
    }
    buffer.push(line);
  }
  flush();

  // 行内残留的标记直接去掉，避免念给用户看
  const cleaned: ReplyPart[] = [];
  for (const part of parts) {
    if (part.type !== 'text') {
      if (part.type === 'descImage' && !part.content) continue;
      cleaned.push(part);
      continue;
    }
    const content = part.content
      .replace(
        /\[(?:表情|sticker|图片|图像|照片|image|语音|voice|红包|red-?packet|约|约定|提醒|remind)\s*[:：][^\]]*\]/gi,
        '',
      )
      .trim();
    if (content) cleaned.push({ type: 'text', content });
  }
  return cleaned;
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
  /** 重新生成：新回复存好之后再删掉被替换的那条，失败就原样留着 */
  replaceMessageId?: string;
  userText?: string;
  speakerId?: string;
}): Promise<void> {
  const { request, reply, chatId, userMessage, userMessages, replaceMessageId } = options;
  if (!request.user) throw new HttpError(401, '未登录');
  const chat = getChatRow(chatId);
  if (!chat) throw new HttpError(404, '会话不存在');

  const isGroup = chat.kind === 'group';
  const members = isGroup ? getChatMembers(chatId) : [];
  let character: CharacterPublic;
  let speaker: ChatMemberPublic | null = null;
  let worldEntries: InjectedWorldEntry[];
  let memory: MemoryPublic | null = null;
  
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
        weather,
        stickers: stickerLibrary,
        promises: listUpcomingPromises(chatId),
        agenda: listAgenda(character.id, todayKey()),
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

    const parts = parseReply(stripTimeMarkers(content.trim()), listStickers());
    if (parts.length === 0) {
      throw new HttpError(502, '模型没有返回内容');
    }

    // 「[约:20:30 …]」只写一条定时记录，到点由调度器生成主动消息
    for (const part of parts) {
      if (part.type === 'promise') {
        createPromise({
          chatId,
          characterId: character.id,
          dueAt: part.dueAt,
          note: part.note,
        });
      } else if (part.type === 'agenda') {
        addAgendaItem(character.id, todayKey(), part.content);
      }
    }

    const savedMessages: MessagePublic[] = [];
    // 同一毫秒插入的多条消息要保证顺序，按解析出来的先后各留 1ms
    let stamp = Date.now();
    for (const part of parts) {
      if (part.type === 'promise' || part.type === 'agenda') continue;
      const kind =
        part.type === 'text'
          ? 'text'
          : part.type === 'sticker'
            ? 'image'
            : part.type === 'voice'
              ? 'voice'
              : part.type === 'packet'
                ? 'red-packet'
                : 'desc-image';
      const body =
        part.type === 'text'
          ? part.content
          : part.type === 'sticker'
            ? part.url
            : part.content;
      const meta =
        part.type === 'voice'
          ? { durationSeconds: part.seconds }
          : part.type === 'packet'
            ? { amount: part.amount }
            : part.type === 'sticker'
              ? { sticker: true, description: part.desc }
              : undefined;
      const message = insertMessage({
        chatId,
        role: 'assistant',
        senderId: character.id,
        kind,
        content: body,
        meta,
        createdAt: stamp,
      });
      stamp += 1;
      savedMessages.push(message);
      saved = message;
      event(reply, 'message', { message });
    }

    touchChat(chatId, 1);
    // 新回复已经存好，这时才真正替换掉旧的那条
    if (replaceMessageId && savedMessages.length > 0) hardDeleteMessage(replaceMessageId);
    event(reply, 'done', { message: saved, messages: savedMessages });
    if (!isGroup) maybeSummarize(chatId);
  } catch (error) {
    const aborted = controller.signal.aborted || reply.raw.destroyed;
    const message = error instanceof HttpError ? error.message : '生成失败，请稍后重试';
    const text = stripTimeMarkers(content.trim());

    // 重新生成失败时不要再存半截内容，旧消息保持原样，避免看起来像“记录消失了”
    if (text && !replaceMessageId) {
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
