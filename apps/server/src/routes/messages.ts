import type { FastifyPluginAsync } from 'fastify';
import { editMessageSchema } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import {
  getMessage,
  softDeleteMessage,
  updateMessageContent,
} from '../db/chats.js';
import { clearMemory } from '../db/memory.js';
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
    // 删掉某个气泡 = 这段剧情不要了，让摘要别再带着它
    if (input.resetMemory) clearMemory(existing.chatId);
    return { message };
  });

  app.delete('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const existing = getMessage(id);
    if (!existing) throw new HttpError(404, '消息不存在');
    if (existing.deletedAt) return { message: existing };
    const message = softDeleteMessage(id);
    if (!message) throw new HttpError(404, '消息不存在');
    // 删除消息后清空长期记忆，重建时只会看剩下的消息
    clearMemory(existing.chatId);
    return { message };
  });
};

export default messageRoutes;
