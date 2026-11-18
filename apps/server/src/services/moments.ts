import type { CharacterPublic, MomentPublic } from '@inkmate/shared';
import { getCharacter, listCharacters } from '../db/characters.js';
import {
  addComment,
  createMoment,
  createMomentJob,
  getMoment,
  getMomentRow,
  hasMomentJobs,
  hasPendingCommentJob,
  incrementMomentJobAttempts,
  likeAsCharacter,
  listDueMomentJobs,
  markMomentJobDone,
  markMomentJobSkipped,
  recentCharacterMomentContents,
  type MomentJobRow,
} from '../db/moments.js';
import { getRecentMessages, getPrivateChatForCharacter } from '../db/chats.js';
import { getMemory } from '../db/memory.js';
import { getPlan, currentBeat } from '../db/schedules.js';
import { getWorldEntriesForCharacter } from '../db/world-books.js';
import { getPrimaryUser } from '../db/users.js';
import { HttpError } from '../lib/http-error.js';
import { completeChat } from '../llm/complete.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';
import { publish } from './events.js';
import { sendPushToAll } from './push.js';

interface LoggerLike {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const jobInFlight = new Set<string>();
const planInFlight = new Set<string>();
const JOB_INTERVAL = 30_000;
const PLAN_INTERVAL = 5 * 60_000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKeyOf(input: Date | number = new Date()): string {
  const date = typeof input === 'number' ? new Date(input) : input;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfDay(input: Date | number = new Date()): number {
  const date = typeof input === 'number' ? new Date(input) : input;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function endOfDay(input: Date | number = new Date()): number {
  return startOfDay(input) + 24 * 60 * 60 * 1000;
}

function formatMemory(character: CharacterPublic, chatId: string): string {
  const memory = getMemory(chatId);
  const parts: string[] = [];
  if (memory.summary?.content) parts.push(`【记忆摘要】${memory.summary.content}`);
  if (memory.facts.length > 0) {
    parts.push(`【事实】${memory.facts.slice(0, 8).map((fact) => fact.content).join('；')}`);
  }
  const recent = getRecentMessages(chatId, 10)
    .map((message) => `${message.role === 'user' ? '用户' : character.name}：${message.content}`)
    .join('\n');
  if (recent) parts.push(`【最近聊天】\n${recent}`);
  return parts.join('\n');
}

function parseMomentOutput(raw: string): { content: string; mood: string } | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as {
        content?: unknown;
        mood?: unknown;
      };
      if (typeof data.content === 'string' && data.content.trim()) {
        return {
          content: data.content.trim().slice(0, 1200),
          mood: typeof data.mood === 'string' ? data.mood.trim().slice(0, 40) : '',
        };
      }
    } catch {
      // fall through
    }
  }
  if (text && !text.startsWith('<skip>') && !text.toLowerCase().includes('json')) {
    return { content: text.slice(0, 1200), mood: '' };
  }
  return null;
}

function parseCommentOutput(raw: string): string | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (!text || text.toLowerCase().includes('<skip>')) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1)) as { content?: unknown };
      if (typeof data.content === 'string' && data.content.trim()) {
        return data.content.trim().slice(0, 500);
      }
    } catch {
      // fall through
    }
  }
  return text.slice(0, 500);
}

function buildMomentPrompt(character: CharacterPublic, scheduledAt: number): string {
  const date = dateKeyOf(scheduledAt);
  const plan = getPlan(character.id, date);
  const beat = currentBeat(character.id, date, scheduledAt);
  const chat = getPrivateChatForCharacter(character.id);
  const world = getWorldEntriesForCharacter(character.id)
    .map((entry) => `${entry.title || '背景'}：${entry.content}`)
    .join('\n')
    .slice(0, 3000);

  return [
    `你在扮演「${character.name}」（${character.nickname || character.name}）。现在是 ${new Date(scheduledAt).toLocaleString('zh-CN')}。`,
    '你要发一条朋友圈式动态，不是聊天消息。',
    '',
    '【你的人设】',
    character.persona.trim() || '自然、真诚。',
    '',
    world ? `【你所在的世界】\n${world}` : '',
    '',
    plan ? `【今天】心情：${plan.mood || '平常'}；${plan.summary || '普通的一天'}` : '',
    beat
      ? `【此刻】你在${beat.activity}${beat.location ? `（${beat.location}）` : ''}，状态${beat.energy || 'normal'}`
      : '',
    chat ? `【最近】\n${formatMemory(character, chat.id)}` : '',
    '',
    '写一条 1–3 句的动态：像随手发的生活片段，有具体细节或小情绪；不要解释、不要@人、不要提“动态/朋友圈/AI”。',
    '只输出 JSON：{"content":"...","mood":"..."}',
  ]
    .filter(Boolean)
    .join('\n');
}

async function processPublishJob(job: MomentJobRow, logger: LoggerLike): Promise<MomentPublic | null> {
  const character = getCharacter(job.character_id);
  if (!character) {
    markMomentJobSkipped(job.id);
    return null;
  }
  if (!character.initiative.allowMoments) {
    markMomentJobSkipped(job.id);
    return null;
  }

  try {
    const config = resolveProviderForCharacter(character);
    const raw = await completeChat(
      config,
      [
        {
          role: 'system',
          content: '你是角色动态生成器。只输出合法 JSON，不要 Markdown。',
        },
        { role: 'user', content: buildMomentPrompt(character, job.scheduled_at) },
      ],
      { maxTokens: 500, temperature: 0.9 },
    );
    const parsed = parseMomentOutput(raw);
    if (!parsed) {
      markMomentJobSkipped(job.id);
      return null;
    }
    const normalized = parsed.content.replace(/\s+/g, '');
    if (
      recentCharacterMomentContents(character.id).some(
        (content) => content.replace(/\s+/g, '') === normalized,
      )
    ) {
      markMomentJobSkipped(job.id);
      return null;
    }
    const plan = getPlan(character.id, dateKeyOf(job.scheduled_at));
    const moment = createMoment({
      authorType: 'character',
      authorId: character.id,
      content: parsed.content,
      mood: parsed.mood,
      planId: plan?.id ?? null,
    });
    markMomentJobDone(job.id);
    publish('moment', { moment });
    void sendPushToAll({
      title: `${character.nickname || character.name} 发了动态`,
      body: moment.content.slice(0, 140),
      url: '/moments',
      tag: `moment-${moment.id}`,
    }).catch(() => undefined);
    logger.info({ characterId: character.id, momentId: moment.id }, '[moments] published');
    return moment;
  } catch (error) {
    const attempts = incrementMomentJobAttempts(job.id);
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        characterId: character.id,
        jobId: job.id,
        attempts,
      },
      '[moments] publish failed',
    );
    if (attempts >= 3) markMomentJobSkipped(job.id);
    return null;
  }
}

async function processCommentJob(job: MomentJobRow, logger: LoggerLike): Promise<void> {
  if (!job.moment_id) {
    markMomentJobSkipped(job.id);
    return;
  }
  const momentRow = getMomentRow(job.moment_id);
  const character = getCharacter(job.character_id);
  const user = getPrimaryUser();
  if (!momentRow || !character || !user) {
    markMomentJobSkipped(job.id);
    return;
  }
  if (!character.initiative.allowMoments) {
    markMomentJobSkipped(job.id);
    return;
  }

  try {
    const moment = getMoment(job.moment_id, user.id);
    if (!moment) {
      markMomentJobSkipped(job.id);
      return;
    }
    const lastUserComment = [...moment.comments]
      .reverse()
      .find((comment) => comment.authorType === 'user');
    const config = resolveProviderForCharacter(character);
    const raw = await completeChat(
      config,
      [
        {
          role: 'system',
          content: '你在扮演一个角色，在朋友圈下面留言。只输出一句自然的短评，或 JSON {"content":"..."}。不要解释，不要提 AI。',
        },
        {
          role: 'user',
          content: [
            `角色：${character.name}（${character.nickname || character.name}）`,
            `人设：${character.persona.slice(0, 1500)}`,
            `动态作者：${moment.authorName}`,
            `动态内容：${moment.content}`,
            lastUserComment ? `用户刚才评论：${lastUserComment.content}` : '',
            '写一句符合角色性格的评论，30 字以内。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { maxTokens: 160, temperature: 0.9 },
    );
    const content = parseCommentOutput(raw);
    if (!content) {
      markMomentJobSkipped(job.id);
      return;
    }
    const normalized = content.replace(/\s+/g, '');
    if (
      moment.comments.some(
        (comment) =>
          comment.authorType === 'character' &&
          comment.authorId === character.id &&
          comment.content.replace(/\s+/g, '') === normalized,
      )
    ) {
      markMomentJobSkipped(job.id);
      return;
    }
    const comment = addComment({
      momentId: moment.id,
      authorType: 'character',
      authorId: character.id,
      content,
    });
    likeAsCharacter(moment.id, character.id);
    markMomentJobDone(job.id);
    publish('moment_comment', { momentId: moment.id, comment });
    logger.info({ momentId: moment.id, characterId: character.id }, '[moments] commented');
  } catch (error) {
    const attempts = incrementMomentJobAttempts(job.id);
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        jobId: job.id,
        attempts,
      },
      '[moments] comment failed',
    );
    if (attempts >= 3) markMomentJobSkipped(job.id);
  }
}

async function tickJobs(logger: LoggerLike): Promise<void> {
  const jobs = listDueMomentJobs(Date.now());
  for (const job of jobs) {
    if (jobInFlight.has(job.id)) continue;
    jobInFlight.add(job.id);
    try {
      if (job.kind === 'publish') await processPublishJob(job, logger);
      else await processCommentJob(job, logger);
    } finally {
      jobInFlight.delete(job.id);
    }
  }
}

function chooseMomentTimes(characterId: string, date: string, now: number, count: number): number[] {
  const plan = getPlan(characterId, date);
  const dayStart = startOfDay(new Date(`${date}T00:00:00`));
  const candidates = plan
    ? plan.beats
        .filter((beat) => {
          const hour = new Date(beat.startAt).getHours();
          return hour >= 9 && hour < 22;
        })
        .map((beat) => beat.startAt + (10 + Math.floor(Math.random() * 40)) * 60_000)
    : [];
  const result = candidates.filter((at) => at > now + 60_000).slice(0, count);
  while (result.length < count) {
    const base = Math.max(now + 5 * 60_000, dayStart + 9 * 60 * 60_000);
    const latest = dayStart + 22 * 60 * 60_000;
    const candidate = base + Math.floor(Math.random() * Math.max(60_000, latest - base));
    if (candidate <= latest) result.push(candidate);
    else break;
  }
  return result.slice(0, count);
}

async function ensureJobsForDate(
  character: CharacterPublic,
  date: string,
  logger: LoggerLike,
): Promise<void> {
  if (!character.initiative.allowMoments || character.initiative.momentsPerDay <= 0) return;
  const start = startOfDay(new Date(`${date}T00:00:00`));
  const end = endOfDay(start);
  if (hasMomentJobs(character.id, start, end)) return;

  const key = `${character.id}:${date}`;
  if (planInFlight.has(key)) return;
  planInFlight.add(key);
  try {
    const now = Date.now();
    const times = chooseMomentTimes(character.id, date, now, character.initiative.momentsPerDay);
    for (const scheduledAt of times) {
      createMomentJob({ kind: 'publish', characterId: character.id, scheduledAt });
    }
    if (times.length > 0) {
      logger.info({ characterId: character.id, date, count: times.length }, '[moments] planned');
    }
  } finally {
    planInFlight.delete(key);
  }
}

async function tickPlans(logger: LoggerLike): Promise<void> {
  const characters = listCharacters().filter((character) => character.initiative.allowMoments);
  const today = dateKeyOf();
  const hour = new Date().getHours();
  for (const character of characters) {
    try {
      await ensureJobsForDate(character, today, logger);
      if (hour >= 22) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await ensureJobsForDate(character, dateKeyOf(tomorrow), logger);
      }
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), characterId: character.id },
        '[moments] plan failed',
      );
    }
  }
}

/** 用户发动态后，安排 1–2 个角色来互动。 */
export function enqueueUserMomentReactions(momentId: string): void {
  const characters = listCharacters().filter(
    (character) => character.initiative.allowMoments,
  );
  const count = Math.min(2, characters.length);
  const picked = characters
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
  picked.forEach((character, index) => {
    createMomentJob({
      kind: 'comment',
      characterId: character.id,
      momentId,
      scheduledAt: Date.now() + (20 + index * 25 + Math.floor(Math.random() * 30)) * 1000,
    });
  });
}

/** 用户评论后，安排动态作者或一个角色回复。 */
export function enqueueMomentReply(momentId: string): void {
  const moment = getMomentRow(momentId);
  if (!moment) return;
  let character: CharacterPublic | null = null;
  if (moment.author_type === 'character') {
    character = getCharacter(moment.author_id);
  }
  if (!character || !character.initiative.allowMoments) {
    character = listCharacters().find((item) => item.initiative.allowMoments) ?? null;
  }
  if (!character) return;
  if (hasPendingCommentJob(character.id, momentId)) return;
  createMomentJob({
    kind: 'comment',
    characterId: character.id,
    momentId,
    scheduledAt: Date.now() + 30_000 + Math.floor(Math.random() * 60_000),
  });
}

export function startMomentScheduler(logger: LoggerLike): () => void {
  const jobTimer = setInterval(() => void tickJobs(logger), JOB_INTERVAL);
  const planTimer = setInterval(() => void tickPlans(logger), PLAN_INTERVAL);
  jobTimer.unref?.();
  planTimer.unref?.();
  setTimeout(() => {
    void tickPlans(logger);
    void tickJobs(logger);
  }, 2_500).unref?.();
  return () => {
    clearInterval(jobTimer);
    clearInterval(planTimer);
  };
}

export async function createUserMoment(
  userId: string,
  content: string,
  images: string[],
): Promise<MomentPublic> {
  if (!content.trim()) throw new HttpError(400, '内容不能为空');
  const moment = createMoment({
    authorType: 'user',
    authorId: userId,
    content: content.trim(),
    images,
  });
  enqueueUserMomentReactions(moment.id);
  publish('moment', { moment });
  return moment;
}

export async function sendTestMoment(
  characterId: string,
  logger: LoggerLike,
): Promise<MomentPublic> {
  const character = getCharacter(characterId);
  if (!character) throw new HttpError(404, '角色不存在');
  if (!character.initiative.allowMoments) {
    throw new HttpError(400, '这个角色还没有开启「允许发动态」');
  }
  const job: MomentJobRow = {
    id: `test-moment-${Date.now()}`,
    kind: 'publish',
    character_id: characterId,
    moment_id: null,
    scheduled_at: Date.now(),
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
  };
  const moment = await processPublishJob(job, logger);
  if (!moment) throw new HttpError(502, '这次没有生成动态，可以再试一次');
  return moment;
}
