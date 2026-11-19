import type { FastifyPluginAsync } from 'fastify';
import { editMessageSchema } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import {
  getMessage,
  softDeleteMessage,
  updateMessageContent,
} from '../db/chats.js';
import { HttpError } from '../lib/http-error.js';

const messageRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const existing = getMessage(id);
    if (!existing) throw new HttpError(404, '消息不存在');
    if (existing.deletedAt) throw new HttpError(400, '消息已删除');
    const input = editMessageSchema.parse(req.body);
    const message = updateMessageContent(id, input.content);
    if (!message) throw new HttpError(404, '消息不存在');
    return { message };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const existing = getMessage(id);
    if (!existing) throw new HttpError(404, '消息不存在');
    if (existing.deletedAt) return { message: existing };
    const message = softDeleteMessage(id);
    if (!message) throw new HttpError(404, '消息不存在');
    return { message };
  });
};

export default messageRoutes;
