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
    '- summary 用 150–500 字，只写「对话里发生过的事」：关系进展、共同经历、约定、还没聊完的话题、对方的偏好。',
    '- 不要复述人设：名字、年龄、职业、性格、外貌、背景设定都已经在角色卡里，写进摘要只是重复一遍；摘要里不要出现自我介绍式的句子。',
    '- 旧摘要里如果混进了人设或自我介绍，重写时删掉，只保留发生过的事和变化。',
    '- facts 只记「值得记住的事件/节点」：关系变动（表白、吵架和好、确认关系）、人生轨迹变化（换工作、搬家、升学、离开）、重要的承诺与约定。',
    '- 不要把人设、外貌、性格、口头禅写进 facts；日常琐事也不要。一条一句话，最多 8 条；importance 1–5（5 = 关系级大事）。',
    '- 已有事实里如果只是人设或琐事，直接丢掉，不要照抄。',
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
