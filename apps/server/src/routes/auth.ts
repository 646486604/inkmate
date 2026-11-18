import type { FastifyPluginAsync } from 'fastify';
import { loginSchema, profilePatchSchema } from '@inkmate/shared';
import { getDb } from '../db/index.js';
import { updateUserProfile } from '../db/users.js';
import { verifyPassword } from '../auth/password.js';
import {
  cleanupExpiredSessions,
  clearSessionCookie,
  createSession,
  deleteCurrentSession,
  requireAuth,
  setSessionCookie,
  toPublicUser,
  type UserRow,
} from '../auth/session.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/login', async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const row = getDb()
      .prepare('SELECT * FROM users WHERE username = ? LIMIT 1')
      .get(username) as unknown as (UserRow & { password_hash: string }) | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      return reply.code(401).send({ error: '密码不正确' });
    }

    cleanupExpiredSessions();
    const { token, expiresAt } = createSession(row.id);
    setSessionCookie(reply, token, expiresAt);
    return { user: toPublicUser(row) };
  });

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    return { user: req.user };
  });

  app.patch('/me', { preHandler: requireAuth }, async (req) => {
    if (!req.user) throw new Error('未登录');
    const patch = profilePatchSchema.parse(req.body);
    const user = updateUserProfile(req.user.id, patch);
    if (!user) throw new Error('保存失败');
    return { user };
  });

  app.post('/logout', async (req, reply) => {
    deleteCurrentSession(req);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};

export default authRoutes;
