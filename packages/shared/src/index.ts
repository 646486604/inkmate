import { z } from 'zod';

export const providerKindSchema = z.enum(['openai', 'gemini', 'custom']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerExtraSchema = z.object({
  chatPath: z.string().trim().max(160).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type ProviderExtra = z.infer<typeof providerExtraSchema>;

export const providerInputSchema = z.object({
  name: z.string().trim().min(1, '请填写名称').max(60),
  kind: providerKindSchema,
  baseUrl: z.string().trim().url('Base URL 格式不正确').max(500),
  apiKey: z.string().trim().max(500).optional().default(''),
  model: z.string().trim().min(1, '请填写模型名').max(120),
  enabled: z.boolean().optional().default(true),
  extra: providerExtraSchema.optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export const providerPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  kind: providerKindSchema.optional(),
  baseUrl: z.string().trim().url('Base URL 格式不正确').max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  extra: providerExtraSchema.optional(),
});
export type ProviderPatch = z.infer<typeof providerPatchSchema>;

export const providerModelsInputSchema = z.object({
  kind: providerKindSchema,
  baseUrl: z.string().trim().url('Base URL 格式不正确').max(500),
  apiKey: z.string().trim().max(500).optional(),
  providerId: z.string().trim().max(64).optional(),
});
export type ProviderModelsInput = z.infer<typeof providerModelsInputSchema>;

export interface ProviderModelsResult {
  models: string[];
}

export interface ProviderPublic {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  maskedKey: string;
  createdAt: number;
  updatedAt: number;
}

export const clockSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, '时间格式应为 HH:MM')
  .refine((value) => {
    const [hour, minute] = value.split(':').map(Number);
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60;
  }, '时间超出范围');

export const initiativeSchema = z.object({
  enabled: z.boolean().optional().default(false),
  level: z.enum(['low', 'normal', 'high']).optional().default('normal'),
  dailyCap: z.number().int().min(1).max(10).optional().default(3),
  minGapMinutes: z.number().int().min(15).max(720).optional().default(90),
  quietStart: clockSchema.optional().default('23:30'),
  quietEnd: clockSchema.optional().default('08:00'),
  testMode: z.boolean().optional().default(false),
  allowMoments: z.boolean().optional().default(false),
  momentsPerDay: z.number().int().min(0).max(3).optional().default(1),
});
export type Initiative = z.infer<typeof initiativeSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(60).optional().default('me'),
  password: z.string().min(1, '请输入密码').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  persona: string;
}

export interface ApiErrorBody {
  error: string;
}

// ── M1: 角色 / 会话 / 消息 ─────────────────────────────────────────────

export const characterInputSchema = z.object({
  name: z.string().trim().min(1, '请填写角色名').max(60),
  nickname: z.string().trim().max(60).optional().default(''),
  avatar: z.string().trim().max(2000).optional().default(''),
  persona: z.string().trim().max(8000).optional().default(''),
  greeting: z.string().trim().max(2000).optional().default(''),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '主题色格式不正确')
    .optional()
    .default('#b4472f'),
  providerId: z.string().trim().max(100).nullable().optional().default(null),
  model: z.string().trim().max(120).optional().default(''),
  memoryLimit: z.number().int().min(6).max(200).optional().default(40),
  worldBookIds: z.array(z.string().trim().min(1).max(100)).optional().default([]),
  initiative: initiativeSchema.optional(),
});
export type CharacterInput = z.infer<typeof characterInputSchema>;

export const characterPatchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  nickname: z.string().trim().max(60).optional(),
  avatar: z.string().trim().max(2000).optional(),
  persona: z.string().trim().max(8000).optional(),
  greeting: z.string().trim().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '主题色格式不正确')
    .optional(),
  providerId: z.string().trim().max(100).nullable().optional(),
  model: z.string().trim().max(120).optional(),
  memoryLimit: z.number().int().min(6).max(200).optional(),
  worldBookIds: z.array(z.string().trim().min(1).max(100)).optional(),
  initiative: initiativeSchema.optional(),
});
export type CharacterPatch = z.infer<typeof characterPatchSchema>;

export interface CharacterPublic {
  id: string;
  name: string;
  nickname: string;
  avatar: string;
  persona: string;
  greeting: string;
  color: string;
  providerId: string | null;
  model: string;
  memoryLimit: number;
  worldBookIds: string[];
  initiative: Initiative;
  createdAt: number;
  updatedAt: number;
}

export const privateChatCreateSchema = z.object({
  characterId: z.string().trim().min(1).max(100),
});

export const groupChatCreateSchema = z.object({
  kind: z.literal('group'),
  title: z.string().trim().min(1, '请填写群名').max(60),
  characterIds: z
    .array(z.string().trim().min(1).max(100))
    .min(2, '至少选择两个角色')
    .max(6, '最多选择六个角色'),
});

export const chatCreateSchema = z.union([
  privateChatCreateSchema,
  groupChatCreateSchema,
]);
export type ChatCreateInput = z.infer<typeof chatCreateSchema>;

export interface ChatMemberPublic {
  characterId: string;
  name: string;
  nickname: string;
  avatar: string;
  color: string;
  persona: string;
  personaOverride: string;
  sortOrder: number;
}

export interface ChatPublic {
  id: string;
  kind: 'private' | 'group';
  title: string;
  characterId: string | null;
  characterName: string;
  characterNickname: string;
  characterAvatar: string;
  characterColor: string;
  members: ChatMemberPublic[];
  /** 这个会话里「我」的名字与人设；空串表示用全局默认 */
  userName: string;
  userPersona: string;
  /** 聊天背景图 url；空串表示没设 */
  background: string;
  lastMessage: string;
  lastMessageKind: MessageKind;
  lastMessageAt: number | null;
  unreadCount: number;
  createdAt: number;
}

export const chatIdentitySchema = z.object({
  userName: z.string().trim().max(40, '名字最多 40 个字').optional(),
  userPersona: z.string().trim().max(4000, '身份设定最多 4000 个字').optional(),
  /** 聊天背景图 url；空串表示清除 */
  background: z.string().trim().max(1000).optional(),
});
export type ChatIdentityInput = z.infer<typeof chatIdentitySchema>;

export const profilePatchSchema = z.object({
  displayName: z.string().trim().max(40, '名字最多 40 个字').optional(),
  persona: z.string().trim().max(4000, '人设最多 4000 个字').optional(),
});
export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** 表情包：上传到服务端，按 /media/<name> 的列表保存 */
export interface StickerPublic {
  url: string;
  /** 给 AI 看的描述，例如「猫猫得意」；空串表示只能手动发 */
  desc: string;
}

export const STICKER_MAX_COUNT = 80;
export const STICKER_MAX_BYTES = 2 * 1024 * 1024;

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, '消息不能为空').max(8000),
  kind: z.enum(['text', 'image']).optional().default('text'),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** 攒了几条一起发：一次插入多条用户消息，再生成一条回复 */
export const sendBatchSchema = z.object({
  contents: z
    .array(z.string().trim().min(1, '消息不能为空').max(8000))
    .min(1, '至少要有一条消息')
    .max(10, '一次最多连发 10 条'),
});
export type SendBatchInput = z.infer<typeof sendBatchSchema>;

export const editMessageSchema = z.object({
  content: z.string().trim().min(1, '消息不能为空').max(8000),
});
export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const regenerateSchema = z.object({
  messageId: z.string().trim().max(100).optional(),
});
export type RegenerateInput = z.infer<typeof regenerateSchema>;

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageKind = 'text' | 'image' | 'system';

export interface MessagePublic {
  id: string;
  chatId: string;
  role: MessageRole;
  senderId: string;
  kind: MessageKind;
  content: string;
  meta: Record<string, unknown>;
  createdAt: number;
  editedAt: number | null;
  deletedAt: number | null;
}

export interface MessagePage {
  messages: MessagePublic[];
  hasMore: boolean;
}

// ── M2: 世界书 / 记忆 ─────────────────────────────────────────────────

export type WorldBookPosition = 'before' | 'after';

export type BeatStatus = 'pending' | 'sent' | 'skipped' | 'missed';

export interface DayBeatPublic {
  id: string;
  planId: string;
  startAt: number;
  endAt: number | null;
  dueAt: number;
  activity: string;
  location: string;
  energy: string;
  contactWorthy: boolean;
  contactIntent: string;
  tone: string;
  status: BeatStatus;
  messageId: string | null;
}

export interface DayPlanPublic {
  id: string;
  characterId: string;
  date: string;
  dayType: string;
  mood: string;
  summary: string;
  status: string;
  beats: DayBeatPublic[];
  createdAt: number;
}

// ── M4: 动态 ─────────────────────────────────────────────────────────

export type MomentAuthorType = 'character' | 'user';

export interface MomentCommentPublic {
  id: string;
  momentId: string;
  authorType: MomentAuthorType;
  authorId: string;
  authorName: string;
  authorNickname: string;
  authorAvatar: string;
  authorColor: string;
  content: string;
  createdAt: number;
}

export interface MomentPublic {
  id: string;
  authorType: MomentAuthorType;
  authorId: string;
  authorName: string;
  authorNickname: string;
  authorAvatar: string;
  authorColor: string;
  content: string;
  images: string[];
  mood: string;
  createdAt: number;
  likeCount: number;
  likedByMe: boolean;
  comments: MomentCommentPublic[];
}

export const momentInputSchema = z.object({
  content: z.string().trim().min(1, '说点什么').max(2000),
  images: z.array(z.string().trim().min(1).max(2000)).max(4).optional().default([]),
});
export type MomentInput = z.infer<typeof momentInputSchema>;

export const momentCommentInputSchema = z.object({
  content: z.string().trim().min(1, '写点什么').max(1000),
});
export type MomentCommentInput = z.infer<typeof momentCommentInputSchema>;

// ── M5: 一起听歌 ─────────────────────────────────────────────────────

export type MusicSource = 'local' | 'netease';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  source: MusicSource;
  streamUrl: string;
  lyrics?: string;
}

export interface MusicSession {
  queue: MusicTrack[];
  index: number;
  positionMs: number;
  playing: boolean;
  updatedAt: number;
}

export interface MusicCommentPublic {
  id: string;
  characterId: string;
  characterName: string;
  characterNickname: string;
  characterAvatar: string;
  characterColor: string;
  trackId: string;
  content: string;
  createdAt: number;
}

export const musicCommentInputSchema = z.object({
  characterId: z.string().trim().min(1).max(100),
  trackId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().max(200).optional().default(''),
  positionMs: z.number().int().min(0).optional().default(0),
  reason: z.enum(['start', 'chorus', 'change', 'manual']).optional().default('start'),
  lyric: z.string().trim().max(500).optional().default(''),
});
export type MusicCommentInput = z.infer<typeof musicCommentInputSchema>;


export const worldBookInputSchema = z.object({
  name: z.string().trim().min(1, '请填写世界书名称').max(80),
  description: z.string().trim().max(500).optional().default(''),
});
export type WorldBookInput = z.infer<typeof worldBookInputSchema>;

export const worldBookPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});
export type WorldBookPatch = z.infer<typeof worldBookPatchSchema>;

/** 单条世界书条目的字符上限（数据库能存更多，但提示词放不下） */
export const WORLD_BOOK_ENTRY_CONTENT_MAX = 100_000;
/** 拼进提示词时「前」/「后」各能容纳的字符数，超出部分会被截断/丢弃 */
export const WORLD_BOOK_CHAR_BUDGET = 24_000;

export const worldBookEntryInputSchema = z.object({
  title: z.string().trim().max(120).optional().default(''),
  content: z
    .string()
    .trim()
    .min(1, '请填写条目内容')
    .max(WORLD_BOOK_ENTRY_CONTENT_MAX, `单条内容最多 ${WORLD_BOOK_ENTRY_CONTENT_MAX} 个字符`),
  position: z.enum(['before', 'after']).optional().default('before'),
  enabled: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(999).optional().default(0),
});
export type WorldBookEntryInput = z.infer<typeof worldBookEntryInputSchema>;

export const worldBookEntryPatchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  content: z
    .string()
    .trim()
    .min(1)
    .max(WORLD_BOOK_ENTRY_CONTENT_MAX, `单条内容最多 ${WORLD_BOOK_ENTRY_CONTENT_MAX} 个字符`)
    .optional(),
  position: z.enum(['before', 'after']).optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type WorldBookEntryPatch = z.infer<typeof worldBookEntryPatchSchema>;

export interface WorldBookEntryPublic {
  id: string;
  bookId: string;
  title: string;
  content: string;
  position: WorldBookPosition;
  enabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorldBookPublic {
  id: string;
  name: string;
  description: string;
  entries: WorldBookEntryPublic[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatSummaryPublic {
  content: string;
  messageCount: number;
  updatedAt: number;
}

export interface FactPublic {
  id: string;
  chatId: string;
  content: string;
  importance: number;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryPublic {
  summary: ChatSummaryPublic | null;
  facts: FactPublic[];
}

export const summaryPatchSchema = z.object({
  summary: z.string().trim().max(8000),
});
export type SummaryPatch = z.infer<typeof summaryPatchSchema>;

export const factInputSchema = z.object({
  content: z.string().trim().min(1, '请填写事实内容').max(500),
  importance: z.number().int().min(1).max(5).optional().default(3),
});
export type FactInput = z.infer<typeof factInputSchema>;

export const factPatchSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  importance: z.number().int().min(1).max(5).optional(),
});
export type FactPatch = z.infer<typeof factPatchSchema>;


