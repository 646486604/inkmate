import type { FastifyPluginAsync } from 'fastify';
import { loginSchema } from '@inkmate/shared';
import { getDb } from '../db/index.js';
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

  app.post('/logout', async (req, reply) => {
    deleteCurrentSession(req);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
};

export default authRoutes;
