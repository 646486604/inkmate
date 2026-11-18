import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PublicUser } from '@inkmate/shared';
import { getDb } from '../db/index.js';
import { cookieSecure } from '../env.js';

export const SESSION_COOKIE = 'inkmate_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
  persona: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    persona: row.persona,
  };
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  getDb()
    .prepare(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(randomUUID(), userId, hashToken(token), expiresAt, Date.now());
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: cookieSecure,
    maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function getSessionUser(req: FastifyRequest): PublicUser | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashToken(token);
  const row = getDb()
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar, u.persona, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? LIMIT 1`,
    )
    .get(tokenHash) as (UserRow & { expires_at: number }) | undefined;

  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return toPublicUser(row);
}

export function deleteCurrentSession(req: FastifyRequest): void {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function cleanupExpiredSessions(): void {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user) return;
  // 401 只有两种可能：浏览器没把 cookie 带上来，或者带上来的 token 在库里查不到。
  // 日志里把这两者区分开，省得每次都靠猜。
  req.log.warn(
    {
      host: req.headers.host,
      origin: req.headers.origin,
      cookie: req.cookies[SESSION_COOKIE] ? 'present' : 'missing',
      ua: (req.headers['user-agent'] ?? '').slice(0, 90),
    },
    '401 未登录',
  );
  await reply.code(401).send({ error: '未登录' });
}
