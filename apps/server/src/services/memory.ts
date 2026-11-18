import type { CharacterPublic, MemoryPublic, MessagePublic } from '@inkmate/shared';
import { getCharacter } from '../db/characters.js';
import { getChatRow, getRecentMessages } from '../db/chats.js';
import {
  addFacts,
  countChatMessages,
  getMemory,
  getSummary,
  upsertSummary,
} from '../db/memory.js';
import { HttpError } from '../lib/http-error.js';
import { completeChat } from '../llm/complete.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';

const inFlight = new Set<string>();
const MIN_MESSAGES = 20;

function formatHistory(character: CharacterPublic, history: MessagePublic[]): string {
  const characterName = character.nickname.trim() || character.name;
  return history
    .map((message) => {
      const content = message.kind === 'image' ? '[图片]' : message.content.trim();
      if (!content) return '';
      const speaker = message.role === 'user' ? '我' : characterName;
      return `${speaker}：${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

function buildMemoryPrompt(
  character: CharacterPublic,
  history: MessagePublic[],
  memory: MemoryPublic,
): string {
  const oldSummary = memory.summary?.content?.trim() || '（暂无）';
  const oldFacts =
    memory.facts.length > 0
      ? memory.facts.map((fact) => `- ${fact.content}`).join('\n')
      : '（暂无）';

  return [
    `你在整理「${character.name}」和用户之间的长期记忆。`,
    '只输出合法 JSON，不要 Markdown 代码块，不要解释。',
    '格式：{"summary":"...","facts":[{"content":"...","importance":1}]}',
    '',
    '要求：',
    '- summary 用 150–500 字，保留称呼、关系、重要事件、偏好、承诺、未完成的话题。',
    '- facts 只保留长期有用、可复用的事实，每条一句话，最多 8 条；importance 1–5。',
    '- 不要编造；不确定的不要写。',
    '- 不要记录敏感隐私（密码、证件、银行卡）。',
    '',
    `【角色】${character.name}（${character.nickname || character.name}）`,
    `【角色设定】${character.persona.slice(0, 1200) || '（无）'}`,
    '',
    `【旧摘要】\n${oldSummary}`,
    `【已有事实】\n${oldFacts}`,
    '',
    `【最近对话】\n${formatHistory(character, history)}`,
  ].join('\n');
}

function parseMemoryOutput(
  raw: string,
): { summary: string; facts: Array<{ content: string; importance: number }> } | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as {
        summary?: unknown;
        facts?: Array<{ content?: unknown; importance?: unknown }>;
      };
      const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
      const facts = Array.isArray(data.facts)
        ? data.facts
            .filter((fact) => typeof fact?.content === 'string' && fact.content.trim())
            .slice(0, 8)
            .map((fact) => ({
              content: String(fact.content).trim().slice(0, 400),
              importance: Math.min(5, Math.max(1, Number(fact.importance) || 3)),
            }))
        : [];
      if (summary) return { summary: summary.slice(0, 4000), facts };
    } catch {
      return null;
    }
  }
  return null;
}

export async function refreshMemory(chatId: string): Promise<MemoryPublic> {
  if (inFlight.has(chatId)) return getMemory(chatId);
  const chat = getChatRow(chatId);
  if (!chat) throw new HttpError(404, '会话不存在');
  if (!chat.character_id) throw new HttpError(400, '群聊记忆暂未支持');
  const character = getCharacter(chat.character_id);
  if (!character) throw new HttpError(404, '角色不存在');
  const config = resolveProviderForCharacter(character);
  const history = getRecentMessages(chatId, 60);
  if (history.length === 0) return getMemory(chatId);

  const before = getMemory(chatId);
  inFlight.add(chatId);
  try {
    const raw = await completeChat(
      config,
      [
        {
          role: 'system',
          content: buildMemoryPrompt(character, history, before),
        },
        { role: 'user', content: '请整理并只输出 JSON。' },
      ],
      { maxTokens: 1000, temperature: 0.2 },
    );
    if (!raw.trim()) throw new HttpError(502, '模型没有返回记忆内容');
    const parsed = parseMemoryOutput(raw);
    if (!parsed) throw new HttpError(502, '记忆整理返回格式不正确，请重试');
    const count = countChatMessages(chatId);
    upsertSummary(chatId, parsed.summary, count);
    if (parsed.facts.length > 0) addFacts(chatId, parsed.facts);
    return getMemory(chatId);
  } finally {
    inFlight.delete(chatId);
  }
}

/** 助手回复落库后调用；不阻塞 SSE。 */
export function maybeSummarize(chatId: string): void {
  const count = countChatMessages(chatId);
  if (count < MIN_MESSAGES) return;
  const summary = getSummary(chatId);
  if (summary && count - summary.messageCount < MIN_MESSAGES) return;
  void refreshMemory(chatId).catch(() => {
    // 记忆整理失败不打扰聊天；下轮再试
  });
}
