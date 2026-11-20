import { randomUUID } from 'node:crypto';
import type {
  MomentAuthorType,
  MomentCommentPublic,
  MomentPublic,
} from '@inkmate/shared';
import { getCharacter } from './characters.js';
import { getPrimaryUser } from './users.js';
import { getDb } from './index.js';

interface MomentRow {
  id: string;
  author_type: MomentAuthorType;
  author_id: string;
  content: string;
  images_json: string;
  mood: string;
  plan_id: string | null;
  chat_id: string;
  created_at: number;
}

interface CommentRow {
  id: string;
  moment_id: string;
  author_type: MomentAuthorType;
  author_id: string;
  content: string;
  created_at: number;
}

export interface MomentJobRow {
  id: string;
  kind: 'publish' | 'comment' | 'social';
  character_id: string;
  moment_id: string | null;
  scheduled_at: number;
  status: string;
  attempts: number;
  created_at: number;
}

function parseImages(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  } catch {
    // ignore
  }
  return [];
}

function authorInfo(authorType: MomentAuthorType, authorId: string, chatId?: string) {
  if (authorType === 'character') {
    const character = getCharacter(authorId);
    return {
      name: character?.name ?? '已删除角色',
      nickname: character?.nickname ?? '',
      avatar: character?.avatar ?? '',
      color: character?.color ?? '#b4472f',
    };
  }
  if (authorType === 'social') {
    // 社交圈里的人：名字直接存在 author_id 里，没有头像
    return { name: authorId, nickname: '', avatar: '', color: '#8a6d5c' };
  }
  // 用户：优先用这个会话里设定的名字，和聊天里保持一致
  const chatName = chatId ? getChatUserName(chatId) : '';
  const user = getPrimaryUser();
  return {
    name: chatName || user?.displayName || '我',
    nickname: '',
    avatar: user?.avatar ?? '',
    color: '#b4472f',
  };
}

function getChatUserName(chatId: string): string {
  const row = getDb()
    .prepare('SELECT user_name FROM chats WHERE id = ?')
    .get(chatId) as { user_name?: string } | undefined;
  return row?.user_name?.trim() ?? '';
}

function toComment(row: CommentRow, chatId?: string): MomentCommentPublic {
  const info = authorInfo(row.author_type, row.author_id, chatId);
  return {
    id: row.id,
    momentId: row.moment_id,
    authorType: row.author_type,
    authorId: row.author_id,
    authorName: info.name,
    authorNickname: info.nickname,
    authorAvatar: info.avatar,
    authorColor: info.color,
    content: row.content,
    createdAt: row.created_at,
  };
}

function commentsFor(momentId: string, chatId?: string): MomentCommentPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM moment_comments WHERE moment_id = ? ORDER BY created_at ASC')
    .all(momentId) as unknown as CommentRow[];
  return rows.map((row) => toComment(row, chatId));
}

function toMoment(row: MomentRow, userId: string): MomentPublic {
  const info = authorInfo(row.author_type, row.author_id, row.chat_id);
  const likeCount = (
    getDb()
      .prepare('SELECT COUNT(*) AS c FROM moment_likes WHERE moment_id = ?')
      .get(row.id) as { c: number }
  ).c;
  const likedByMe = Boolean(
    getDb()
      .prepare(
        "SELECT 1 AS yes FROM moment_likes WHERE moment_id = ? AND actor_type = 'user' AND actor_id = ?",
      )
      .get(row.id, userId),
  );
  return {
    id: row.id,
    authorType: row.author_type,
    authorId: row.author_id,
    authorName: info.name,
    authorNickname: info.nickname,
    authorAvatar: info.avatar,
    authorColor: info.color,
    content: row.content,
    images: parseImages(row.images_json),
    mood: row.mood,
    createdAt: row.created_at,
    likeCount,
    likedByMe,
    comments: commentsFor(row.id, row.chat_id),
  };
}

export function listMoments(
  userId: string,
  limit = 20,
  before?: number,
  characterId?: string,
  chatId?: string,
): MomentPublic[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM moments
       WHERE (? IS NULL OR created_at < ?)
         AND (? IS NULL OR (author_type = 'character' AND author_id = ?))
         AND (? IS NULL OR chat_id = ?)
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(
      before ?? null,
      before ?? null,
      characterId ?? null,
      characterId ?? null,
      chatId ?? null,
      chatId ?? null,
      Math.min(50, Math.max(1, limit)),
    ) as unknown as MomentRow[];
  return rows.map((row) => toMoment(row, userId));
}

export function getMoment(id: string, userId: string): MomentPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM moments WHERE id = ?')
    .get(id) as unknown as MomentRow | undefined;
  return row ? toMoment(row, userId) : null;
}

export function createMoment(input: {
  authorType: MomentAuthorType;
  authorId: string;
  content: string;
  images?: string[];
  mood?: string;
  planId?: string | null;
  chatId?: string;
}): MomentPublic {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO moments
        (id, author_type, author_id, content, images_json, mood, plan_id, chat_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.authorType,
      input.authorId,
      input.content,
      JSON.stringify(input.images ?? []),
      input.mood ?? '',
      input.planId ?? null,
      input.chatId ?? '',
      now,
    );
  const user = getPrimaryUser();
  const moment = getMoment(id, user?.id ?? '');
  if (!moment) throw new Error('动态创建失败');
  return moment;
}

export function deleteMoment(id: string): boolean {
  const result = getDb().prepare('DELETE FROM moments WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

/** 会话删掉时，它的动态一起消失 */
export function deleteMomentsForChat(chatId: string): void {
  if (!chatId) return;
  const db = getDb();
  db.prepare(
    'DELETE FROM moment_comments WHERE moment_id IN (SELECT id FROM moments WHERE chat_id = ?)',
  ).run(chatId);
  db.prepare(
    'DELETE FROM moment_likes WHERE moment_id IN (SELECT id FROM moments WHERE chat_id = ?)',
  ).run(chatId);
  db.prepare('DELETE FROM moments WHERE chat_id = ?').run(chatId);
}

export function recentCharacterMomentContents(characterId: string, limit = 10): string[] {
  const rows = getDb()
    .prepare(
      "SELECT content FROM moments WHERE author_type = 'character' AND author_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(characterId, limit) as unknown as Array<{ content: string }>;
  return rows.map((row) => row.content);
}

export function toggleLike(
  momentId: string,
  userId: string,
): { liked: boolean; likeCount: number } {
  const db = getDb();
  const existing = db
    .prepare(
      "SELECT 1 AS yes FROM moment_likes WHERE moment_id = ? AND actor_type = 'user' AND actor_id = ?",
    )
    .get(momentId, userId);
  if (existing) {
    db.prepare(
      "DELETE FROM moment_likes WHERE moment_id = ? AND actor_type = 'user' AND actor_id = ?",
    ).run(momentId, userId);
  } else {
    db.prepare(
      "INSERT INTO moment_likes (moment_id, actor_type, actor_id, created_at) VALUES (?, 'user', ?, ?)",
    ).run(momentId, userId, Date.now());
  }
  const likeCount = (
    db.prepare('SELECT COUNT(*) AS c FROM moment_likes WHERE moment_id = ?').get(momentId) as {
      c: number;
    }
  ).c;
  return { liked: !existing, likeCount };
}

export function likeAsCharacter(momentId: string, characterId: string): void {  getDb()
    .prepare(
      "INSERT OR IGNORE INTO moment_likes (moment_id, actor_type, actor_id, created_at) VALUES (?, 'character', ?, ?)",
    )
    .run(momentId, characterId, Date.now());
}

/** 社交圈的人点赞：名字直接当 author_id */
export function likeAsSocial(momentId: string, name: string): void {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO moment_likes (moment_id, actor_type, actor_id, created_at) VALUES (?, 'social', ?, ?)",
    )
    .run(momentId, name, Date.now());
}

export function hasSocialLike(momentId: string, name: string): boolean {
  return Boolean(
    getDb()
      .prepare(
        "SELECT 1 AS yes FROM moment_likes WHERE moment_id = ? AND actor_type = 'social' AND actor_id = ?",
      )
      .get(momentId, name),
  );
}

export function addComment(input: {
  momentId: string;
  authorType: MomentAuthorType;
  authorId: string;
  content: string;
}): MomentCommentPublic {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO moment_comments (id, moment_id, author_type, author_id, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.momentId, input.authorType, input.authorId, input.content, now);
  const row = getDb()
    .prepare('SELECT * FROM moment_comments WHERE id = ?')
    .get(id) as unknown as CommentRow;
  const moment = getMomentRow(input.momentId);
  return toComment(row, moment?.chat_id);
}

export function getMomentRow(id: string): MomentRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM moments WHERE id = ?')
      .get(id) as unknown as MomentRow | undefined) ?? null
  );
}

export function createMomentJob(input: {
  kind: 'publish' | 'comment' | 'social';
  characterId: string;
  momentId?: string | null;
  scheduledAt: number;
}): MomentJobRow {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO moment_jobs
        (id, kind, character_id, moment_id, scheduled_at, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
    )
    .run(id, input.kind, input.characterId, input.momentId ?? null, input.scheduledAt, now);
  return getDb()
    .prepare('SELECT * FROM moment_jobs WHERE id = ?')
    .get(id) as unknown as MomentJobRow;
}

export function listDueMomentJobs(now: number): MomentJobRow[] {
  return getDb()
    .prepare(
      "SELECT * FROM moment_jobs WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 20",
    )
    .all(now) as unknown as MomentJobRow[];
}

export function markMomentJobDone(id: string): void {
  getDb().prepare("UPDATE moment_jobs SET status = 'done' WHERE id = ?").run(id);
}

export function markMomentJobSkipped(id: string): void {
  getDb().prepare("UPDATE moment_jobs SET status = 'skipped' WHERE id = ?").run(id);
}

export function incrementMomentJobAttempts(id: string): number {
  getDb().prepare('UPDATE moment_jobs SET attempts = attempts + 1 WHERE id = ?').run(id);
  const row = getDb().prepare('SELECT attempts FROM moment_jobs WHERE id = ?').get(id) as
    | { attempts: number }
    | undefined;
  return row?.attempts ?? 0;
}

export function hasMomentJobs(characterId: string, start: number, end: number): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS yes FROM moment_jobs WHERE character_id = ? AND kind = 'publish' AND scheduled_at >= ? AND scheduled_at < ? LIMIT 1",
    )
    .get(characterId, start, end);
  return Boolean(row);
}

export function nextMomentPublication(characterId: string): number | null {
  const row = getDb()
    .prepare(
      "SELECT MIN(scheduled_at) AS at FROM moment_jobs WHERE character_id = ? AND kind = 'publish' AND status = 'pending'",
    )
    .get(characterId) as { at: number | null } | undefined;
  return row?.at ?? null;
}

export function hasPendingCommentJob(characterId: string, momentId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 AS yes FROM moment_jobs WHERE character_id = ? AND moment_id = ? AND kind = 'comment' AND status = 'pending' LIMIT 1",
    )
    .get(characterId, momentId);
  return Boolean(row);
}
