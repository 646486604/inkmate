import type { CharacterPublic, DayBeatPublic, DayPlanPublic, MessagePublic } from '@inkmate/shared';
import { getCharacter, listCharacters } from '../db/characters.js';
import {
  createChatForCharacter,
  getChatRow,
  getLastMessage,
  getPrivateChatForCharacter,
  getRecentMessages,
  insertMessage,
  touchChat,
} from '../db/chats.js';
import { getMemory } from '../db/memory.js';
import {
  countSentBeats,
  currentBeat,
  incrementBeatAttempts,
  lastSentBeat,
  listDueBeats,
  markBeatMissed,
  markBeatSent,
  markBeatSkipped,
  nextBeat,
  replacePlan,
  getPlan,
  type DueBeat,
  type NewBeat,
} from '../db/schedules.js';
import { getWorldEntriesForCharacter } from '../db/world-books.js';
import { getPrimaryUser } from '../db/users.js';
import { HttpError } from '../lib/http-error.js';
import { completeChat } from '../llm/complete.js';
import { buildProactiveMessages } from '../llm/prompt.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';
import { maybeSummarize } from './memory.js';
import { listDuePromises, markPromise } from '../db/promises.js';
import { listQuestionsToFollowUp, markFollowedUp } from '../db/questions.js';
import { publish } from './events.js';
import { sendPushToAll } from './push.js';
import { getWeatherText } from './weather.js';

interface LoggerLike {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const planInFlight = new Set<string>();
const beatInFlight = new Set<string>();
const promiseInFlight = new Set<string>();
const followUpInFlight = new Set<string>();
const FOLLOW_UP_MIN_AGE_MS = 30 * 60 * 1000;
const PLAN_CHECK_MS = 5 * 60 * 1000;
const BEAT_CHECK_MS = 30 * 1000;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dateKeyOf(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrowKey(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  return dateKeyOf(date);
}

function parseClock(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return NaN;
  return hour * 60 + minute;
}

function clockToTimestamp(date: string, clock: string): number {
  const minutes = parseClock(clock);
  if (!Number.isFinite(minutes)) return NaN;
  const dateObj = new Date(`${date}T00:00:00`);
  dateObj.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return dateObj.getTime();
}

function isQuiet(now: Date, start: string, end: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const from = parseClock(start);
  const to = parseClock(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

function formatRecentMemory(characterId: string, chatId: string): string {
  void characterId;
  const memory = getMemory(chatId);
  const lines: string[] = [];
  if (memory.summary?.content) lines.push(`【摘要】${memory.summary.content}`);
  if (memory.facts.length > 0) {
    lines.push(`【事实】${memory.facts.slice(0, 10).map((fact) => fact.content).join('；')}`);
  }
  const history = getRecentMessages(chatId, 16)
    .map((message) => {
      const speaker = message.role === 'user' ? '用户' : '角色';
      const content = message.kind === 'image' ? '[图片]' : message.content;
      return `${speaker}：${content}`;
    })
    .join('\n');
  if (history) lines.push(`【最近对话】\n${history}`);
  return lines.join('\n');
}

function fallbackBeats(date: string, initiative: CharacterPublic['initiative']): NewBeat[] {
  void initiative;
  const plan: Array<[string, string, string, boolean, string, string]> = [
    ['08:00', '08:40', '起床、洗漱', false, '', ''],
    ['09:00', '12:00', '上课 / 忙自己的事', false, '', ''],
    ['12:10', '13:00', '吃午饭', true, '问问对方吃了没', '随口'],
    ['14:00', '17:30', '下午的课 / 做事', false, '', ''],
    ['18:00', '19:00', '晚饭、走动一下', true, '分享今天的一件小事', '自然'],
    ['21:30', '23:00', '洗漱、准备睡', false, '', ''],
  ];
  return plan.map(([start, end, activity, worthy, intent, tone]) => {
    const startAt = clockToTimestamp(date, start);
    return {
      startAt,
      endAt: clockToTimestamp(date, end),
      dueAt: startAt + Math.floor(Math.random() * 16) * 60_000,
      activity,
      contactWorthy: worthy,
      contactIntent: intent,
      tone,
      energy: 'normal',
    };
  });
}

function sanitizePlanJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('日程不是 JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function buildBeats(
  date: string,
  data: unknown,
  initiative: CharacterPublic['initiative'],
): { beats: NewBeat[]; dayType: string; mood: string; summary: string; raw: unknown } {
  const body = data as {
    day_type?: unknown;
    dayType?: unknown;
    mood?: unknown;
    summary?: unknown;
    beats?: Array<{
      start?: unknown;
      end?: unknown;
      activity?: unknown;
      location?: unknown;
      energy?: unknown;
      contactWorthy?: unknown;
      contactIntent?: unknown;
      tone?: unknown;
      contact?: { worthy?: unknown; intent?: unknown; tone?: unknown };
    }>;
  };
  if (!Array.isArray(body.beats) || body.beats.length === 0) {
    throw new Error('日程没有节拍');
  }

  const beats: NewBeat[] = [];
  for (const item of body.beats.slice(0, 10)) {
    const start = typeof item.start === 'string' ? item.start : '';
    const startAt = clockToTimestamp(date, start);
    if (!Number.isFinite(startAt)) continue;
    const endAt = typeof item.end === 'string' ? clockToTimestamp(date, item.end) : NaN;
    const contact = item.contact ?? {};
    const worthy =
      item.contactWorthy === true ||
      item.contactWorthy === 1 ||
      contact.worthy === true ||
      contact.worthy === 1;
    const dueAt =
      startAt + Math.floor(Math.random() * (initiative.testMode ? 1 : 16)) * 60_000;
    beats.push({
      startAt,
      endAt: Number.isFinite(endAt) && endAt > startAt ? endAt : startAt + 60 * 60_000,
      dueAt,
      activity:
        typeof item.activity === 'string' && item.activity.trim()
          ? item.activity.trim().slice(0, 80)
          : '忙自己的事',
      location: typeof item.location === 'string' ? item.location.trim().slice(0, 40) : '',
      energy: typeof item.energy === 'string' ? item.energy.trim().slice(0, 20) : 'normal',
      contactWorthy: worthy,
      contactIntent:
        typeof contact.intent === 'string'
          ? contact.intent.trim().slice(0, 120)
          : typeof item.contactIntent === 'string'
            ? item.contactIntent.trim().slice(0, 120)
            : '',
      tone:
        typeof contact.tone === 'string'
          ? contact.tone.trim().slice(0, 40)
          : typeof item.tone === 'string'
            ? item.tone.trim().slice(0, 40)
            : '',
    });
  }

  if (beats.length < 3) throw new Error('日程节拍太少');
  beats.sort((a, b) => a.startAt - b.startAt);

  let contacts = beats.filter((beat) => beat.contactWorthy);
  if (contacts.length === 0) {
    const noon = beats[Math.min(2, beats.length - 1)];
    if (noon) {
      noon.contactWorthy = true;
      noon.contactIntent = '想问问对方今天怎么样';
      noon.tone = '自然';
    }
  }
  contacts = beats.filter((beat) => beat.contactWorthy);
  if (contacts.length > 4) {
    for (const beat of contacts.slice(4)) beat.contactWorthy = false;
  }
  const kept: NewBeat[] = [];
  for (const beat of beats.filter((item) => item.contactWorthy)) {
    const previous = kept[kept.length - 1];
    if (previous && beat.startAt - previous.startAt < 60 * 60_000) {
      beat.contactWorthy = false;
      continue;
    }
    kept.push(beat);
  }

  return {
    beats,
    dayType:
      typeof body.day_type === 'string'
        ? body.day_type
        : typeof body.dayType === 'string'
          ? body.dayType
          : 'ordinary',
    mood: typeof body.mood === 'string' ? body.mood.slice(0, 80) : '平常',
    summary: typeof body.summary === 'string' ? body.summary.slice(0, 300) : '',
    raw: data,
  };
}

function worthhy(value: boolean): boolean {
  return value;
}

async function generatePlan(
  character: CharacterPublic,
  date: string,
  logger: LoggerLike,
): Promise<DayPlanPublic> {
  const key = `${character.id}:${date}`;
  if (planInFlight.has(key)) {
    const existing = getPlan(character.id, date);
    if (existing) return existing;
    throw new HttpError(409, '日程正在生成');
  }
  planInFlight.add(key);
  try {
    const config = resolveProviderForCharacter(character);
    const yesterdayDate = new Date(`${date}T00:00:00`);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = getPlan(character.id, dateKeyOf(yesterdayDate));
    const chat = getPrivateChatForCharacter(character.id);
    const memory = chat ? formatRecentMemory(character.id, chat.id) : '';
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][
      new Date(`${date}T12:00:00`).getDay()
    ];

    const weather = await getWeatherText();

    const raw = await completeChat(
      config,
      [
        {
          role: 'system',
          content: [
            '你是角色当天「计划表」的生成器，不写台词，只输出 JSON。',
            '格式：{"day_type":"workday|weekend|ordinary","mood":"...","summary":"...","beats":[{"start":"HH:MM","end":"HH:MM","activity":"...","location":"...","energy":"low|normal|high","contact":{"worthy":true,"intent":"...","tone":"..."}}]}',
            '规则：',
            '- 6–10 个生活节拍，从起床到睡前，时间递增；活动要符合角色设定。',
            '- 这是“打算做什么”的计划，不是已经发生的事实：允许推迟、取消、临时改变，也别写得像流水账。',
            '- 1–4 个 contact.worthy=true 的联系点，间隔至少 60 分钟；intent 只写“为什么此刻想找对方”（想念、想分享心情、忽然想起某件事），不要写工作内容、汇报、会议、项目、客户、数据。',
            '- 80% 是普通日常，不要每天都发生戏剧性事件；不要写用户也在场。',
            '- 不要写“发消息”“联系用户”这类出戏措辞，只写角色自己的生活。',
            '- 不要编造具体的天气、新闻、比赛结果等外部事实。',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `角色：${character.name}（${character.nickname || character.name}）`,
            `人设：${character.persona.slice(0, 2500) || '（无）'}`,
            `日期：${date} 星期${weekday}`,
            weather ? `今天天气：${weather}（计划要配合天气，下雨就别安排户外）` : '',
            yesterday
              ? `昨天：${yesterday.summary || yesterday.mood || '（无摘要）'}`
              : '昨天：（没有记录）',
            memory ? `最近记忆：\n${memory}` : '',
            '请生成今天的计划，只输出 JSON。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      { maxTokens: 1400, temperature: 0.8 },
    );

    let parsed: { beats: NewBeat[]; dayType: string; mood: string; summary: string; raw: unknown };
    try {
      parsed = buildBeats(date, sanitizePlanJson(raw), character.initiative);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), character: character.id },
        '[proactive] 日程 JSON 解析失败，使用兜底日程',
      );
      parsed = {
        beats: fallbackBeats(date, character.initiative),
        dayType: 'ordinary',
        mood: '平常',
        summary: '普通的一天',
        raw: { fallback: true },
      };
    }

    return replacePlan(character.id, date, parsed);
  } finally {
    planInFlight.delete(key);
  }
}

export async function refreshPlan(characterId: string): Promise<DayPlanPublic> {
  const character = getCharacter(characterId);
  if (!character) throw new HttpError(404, '角色不存在');
  return generatePlan(character, dateKeyOf(), {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });
}

export function getSchedule(characterId: string, date?: string): DayPlanPublic | null {
  return getPlan(characterId, date || dateKeyOf());
}

export function getScheduleContext(characterId: string): {
  mood: string;
  summary: string;
  current?: { activity: string; location?: string; energy?: string };
  next?: { activity: string; startAt: number };
} | null {
  const date = dateKeyOf();
  const plan = getPlan(characterId, date);
  if (!plan) return null;
  const now = Date.now();
  const current = currentBeat(characterId, date, now);
  const upcoming = nextBeat(characterId, date, now);
  return {
    mood: plan.mood,
    summary: plan.summary,
    current: current
      ? { activity: current.activity, location: current.location, energy: current.energy }
      : undefined,
    next: upcoming ? { activity: upcoming.activity, startAt: upcoming.start_at } : undefined,
  };
}

function lastAssistantTexts(chatId: string): string[] {
  return getRecentMessages(chatId, 20)
    .filter((message) => message.role === 'assistant' && !message.deletedAt)
    .slice(-5)
    .map((message) => normalize(message.content));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?~～…]/g, '').toLowerCase();
}

async function processBeat(
  beat: DueBeat,
  logger: LoggerLike,
  options: { force?: boolean; test?: boolean } = {},
): Promise<MessagePublic | null> {
  const character = getCharacter(beat.character_id);
  if (!character) return null;
  const chat = getPrivateChatForCharacter(character.id);
  if (!chat) {
    if (!options.test) markBeatSkipped(beat.id);
    return null;
  }

  const initiative = character.initiative;
  const now = new Date();
  if (!options.force && !initiative.enabled) {
    markBeatSkipped(beat.id);
    return null;
  }

  if (!options.force) {
    if (!initiative.testMode && isQuiet(now, initiative.quietStart, initiative.quietEnd)) return null;
    if (countSentBeats(character.id, beat.plan_date) >= initiative.dailyCap) {
      markBeatSkipped(beat.id);
      return null;
    }
    const lastSent = lastSentBeat(character.id, beat.plan_date);
    const gapMs = (initiative.testMode ? 1 : initiative.minGapMinutes) * 60_000;
    if (lastSent && Date.now() - lastSent.due_at < gapMs) return null;
    const lastMessage = getLastMessage(chat.id);
    if (lastMessage) {
      if (lastMessage.role === 'user' && Date.now() - lastMessage.createdAt < 6 * 60 * 60_000) {
        return null;
      }
      if (lastMessage.role === 'assistant' && Date.now() - lastMessage.createdAt < gapMs) {
        return null;
      }
    }
    if (Date.now() - beat.due_at > 2 * 60 * 60_000) {
      markBeatMissed(beat.id);
      return null;
    }
    const chance =
      initiative.testMode ? 1 : initiative.level === 'low' ? 0.45 : initiative.level === 'high' ? 0.9 : 0.72;
    if (Math.random() > chance) {
      markBeatSkipped(beat.id);
      return null;
    }
  }

  try {
    const config = resolveProviderForCharacter(character);
    const history = getRecentMessages(chat.id, 24);
    const upcoming = nextBeat(character.id, beat.plan_date, beat.start_at);
    const messages = buildProactiveMessages({
      character,
      user:
        getPrimaryUser() ?? {
          id: '',
          username: 'me',
          displayName: '我',
          avatar: '',
          persona: '',
        },
      history,
      memory: getMemory(chat.id),
      worldEntries: getWorldEntriesForCharacter(character.id),
      beat: {
        activity: beat.activity,
        location: beat.location,
        energy: beat.energy,
        contactIntent: beat.contact_intent,
        tone: beat.tone,
      },
      nextBeat: upcoming
        ? { activity: upcoming.activity, startAt: upcoming.start_at }
        : null,
      now,
    });

    const raw = await completeChat(config, messages, { maxTokens: 320, temperature: 0.9 });
    const text = raw.trim();
    if (!text || /^<skip>$/i.test(text) || text.toLowerCase().includes('<skip>')) {
      if (!options.test) markBeatSkipped(beat.id);
      return null;
    }
    const content = text.slice(0, 800);
    if (lastAssistantTexts(chat.id).includes(normalize(content))) {
      if (!options.test) markBeatSkipped(beat.id);
      return null;
    }

    const message = insertMessage({
      chatId: chat.id,
      role: 'assistant',
      senderId: character.id,
      kind: 'text',
      content,
      meta: {
        proactive: true,
        beatId: beat.id,
        planId: beat.plan_id,
        ...(options.test ? { test: true } : {}),
      },
    });
    touchChat(chat.id, 1);
    if (!options.test) markBeatSent(beat.id, message.id);
    maybeSummarize(chat.id);
    publish('proactive', {
      chatId: chat.id,
      characterId: character.id,
      message,
      beatId: beat.id,
    });
    void sendPushToAll({
      title: character.nickname || character.name,
      body: content.slice(0, 140),
      url: `/chats/${chat.id}`,
      tag: `message-${message.id}`,
    }).catch(() => undefined);
    logger.info(
      { characterId: character.id, chatId: chat.id, beatId: beat.id, test: options.test },
      '[proactive] sent',
    );
    return message;
  } catch (error) {
    const attempts = incrementBeatAttempts(beat.id);
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        characterId: character.id,
        beatId: beat.id,
        attempts,
      },
      '[proactive] generate failed',
    );
    if (attempts >= 3) markBeatSkipped(beat.id);
    return null;
  }
}

export async function runDueBeats(logger: LoggerLike): Promise<void> {
  const now = new Date();
  const date = dateKeyOf(now);
  const due = listDueBeats(now.getTime(), date);
  for (const beat of due) {
    if (beatInFlight.has(beat.id)) continue;
    beatInFlight.add(beat.id);
    try {
      await processBeat(beat, logger);
    } finally {
      beatInFlight.delete(beat.id);
    }
  }
}

export async function sendTestProactive(characterId: string, logger: LoggerLike): Promise<MessagePublic> {
  const character = getCharacter(characterId);
  if (!character) throw new HttpError(404, '角色不存在');
  let chat = getPrivateChatForCharacter(characterId);
  if (!chat) {
    const result = createChatForCharacter(character);
    chat = result.chat;
  }
  const date = dateKeyOf();
  let plan = getPlan(characterId, date);
  if (!plan) {
    plan = await generatePlan(character, date, logger);
  }
  const beat = {
    id: `test-${Date.now()}`,
    plan_id: plan.id,
    start_at: Date.now(),
    end_at: Date.now() + 60 * 60_000,
    due_at: Date.now(),
    activity: currentBeat(characterId, date, Date.now())?.activity ?? '此刻',
    location: '',
    energy: 'normal',
    contact_worthy: 1,
    contact_intent: '想和对方说句话',
    tone: '自然',
    status: 'pending',
    message_id: null,
    attempts: 0,
    created_at: Date.now(),
    character_id: characterId,
    plan_date: date,
    mood: plan.mood,
    summary: plan.summary,
  } satisfies DueBeat;
  const message = await processBeat(beat, logger, { force: true, test: true });
  if (!message) throw new HttpError(502, '这次没有生成内容，可以再试一次');
  return message;
}

async function tickPlans(logger: LoggerLike): Promise<void> {
  const characters = listCharacters().filter((character) => character.initiative.enabled);
  const today = dateKeyOf();
  const hour = new Date().getHours();
  for (const character of characters) {
    try {
      if (!getPlan(character.id, today)) {
        await generatePlan(character, today, logger);
      }
      if (hour >= 22) {
        const tomorrow = tomorrowKey();
        if (!getPlan(character.id, tomorrow)) {
          await generatePlan(character, tomorrow, logger);
        }
      }
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), characterId: character.id },
        '[proactive] plan generation failed',
      );
    }
  }
}

/** 角色答应过“几点来找你”：到点用和主动消息同一条管道发一条 */
export async function runDuePromises(logger: LoggerLike): Promise<void> {
  const due = listDuePromises();
  for (const promise of due) {
    if (promiseInFlight.has(promise.id)) continue;
    promiseInFlight.add(promise.id);
    try {
      const character = getCharacter(promise.character_id);
      if (!character) {
        markPromise(promise.id, 'skipped');
        continue;
      }
      const now = new Date();
      // 安静时段先不发，等过了再补（保留 pending，下一轮再看）
      if (
        !character.initiative.testMode &&
        isQuiet(now, character.initiative.quietStart, character.initiative.quietEnd)
      ) {
        continue;
      }

      const date = dateKeyOf(now);
      let plan = getPlan(character.id, date);
      if (!plan) plan = await generatePlan(character, date, logger);
      const beat: DueBeat = {
        id: `promise-${promise.id}`,
        plan_id: plan.id,
        start_at: promise.due_at,
        end_at: promise.due_at + 60 * 60_000,
        due_at: promise.due_at,
        activity: currentBeat(character.id, date, Date.now())?.activity ?? '此刻',
        location: '',
        energy: 'normal',
        contact_worthy: 1,
        contact_intent: promise.note
          ? `之前答应过这个时间来找对方：${promise.note}`
          : '之前答应过这个时间来找对方',
        tone: '自然',
        status: 'pending',
        message_id: null,
        attempts: 0,
        created_at: Date.now(),
        character_id: character.id,
        plan_date: date,
        mood: plan.mood,
        summary: plan.summary,
      };
      const message = await processBeat(beat, logger, { force: true });
      markPromise(promise.id, message ? 'sent' : 'skipped', message?.id ?? null);
      if (message) {
        logger.info(
          { characterId: character.id, chatId: promise.chat_id, promiseId: promise.id },
          '[promise] sent',
        );
      }
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), promiseId: promise.id },
        '[promise] send failed',
      );
    } finally {
      promiseInFlight.delete(promise.id);
    }
  }
}

/** 角色问过、对方一直没回：过一阵自然地追问一次（不重复原问题） */
export async function runDueFollowUps(logger: LoggerLike): Promise<void> {
  const due = listQuestionsToFollowUp(FOLLOW_UP_MIN_AGE_MS);
  if (due.length === 0) return;
  for (const item of due) {
    if (followUpInFlight.has(item.id)) continue;
    followUpInFlight.add(item.id);
    try {
      const character = getCharacter(item.character_id);
      const chat = getChatRow(item.chat_id);
      if (!character || !chat) {
        markFollowedUp(item.id);
        continue;
      }
      const now = new Date();
      if (
        !character.initiative.testMode &&
        isQuiet(now, character.initiative.quietStart, character.initiative.quietEnd)
      ) {
        continue;
      }
      const last = getLastMessage(item.chat_id);
      if (last && last.role === 'user') {
        markFollowedUp(item.id);
        continue;
      }
      const date = dateKeyOf(now);
      const plan = getPlan(character.id, date);
      const beat: DueBeat = {
        id: `followup-${item.id}`,
        plan_id: plan?.id ?? '',
        start_at: Date.now(),
        end_at: Date.now() + 30 * 60_000,
        due_at: Date.now(),
        activity: currentBeat(character.id, date, Date.now())?.activity ?? '此刻',
        location: '',
        energy: 'normal',
        contact_worthy: 1,
        contact_intent: `你之前问过对方「${item.question}」，一直没回；可以自然地再提一句，或者换个角度关心一下。不要机械重复原问题，也不要质问。`,
        tone: '自然',
        status: 'pending',
        message_id: null,
        attempts: 0,
        created_at: Date.now(),
        character_id: character.id,
        plan_date: date,
        mood: plan?.mood ?? '',
        summary: plan?.summary ?? '',
      };
      const message = await processBeat(beat, logger, { force: true });
      markFollowedUp(item.id);
      if (message) {
        logger.info(
          { characterId: character.id, chatId: item.chat_id, questionId: item.id },
          '[followup] sent',
        );
      }
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error), questionId: item.id },
        '[followup] failed',
      );
    } finally {
      followUpInFlight.delete(item.id);
    }
  }
}

export function startProactiveScheduler(logger: LoggerLike): () => void {
  const planTimer = setInterval(() => void tickPlans(logger), PLAN_CHECK_MS);
  const beatTimer = setInterval(() => void runDueBeats(logger), BEAT_CHECK_MS);
  const promiseTimer = setInterval(() => void runDuePromises(logger), BEAT_CHECK_MS);
  const followUpTimer = setInterval(() => void runDueFollowUps(logger), 5 * 60 * 1000);
  planTimer.unref?.();
  beatTimer.unref?.();
  promiseTimer.unref?.();
  followUpTimer.unref?.();
  setTimeout(() => {
    void tickPlans(logger);
    void runDueBeats(logger);
    void runDuePromises(logger);
    void runDueFollowUps(logger);
  }, 2_000).unref?.();
  return () => {
    clearInterval(planTimer);
    clearInterval(beatTimer);
    clearInterval(promiseTimer);
    clearInterval(followUpTimer);
  };
}
