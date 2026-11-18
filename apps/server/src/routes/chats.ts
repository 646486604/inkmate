import type { FastifyPluginAsync } from 'fastify';
import {
  chatCreateSchema,
  factInputSchema,
  regenerateSchema,
  sendMessageSchema,
  summaryPatchSchema,
} from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import { getCharacter } from '../db/characters.js';
import {
  createChatForCharacter,
  createGroupChat,
  deleteChat,
  getChat,
  getChatRow,
  getLastAssistantMessage,
  getLastUserMessage,
  getMessage,
  hardDeleteMessage,
  insertMessage,
  listChats,
  listMessages,
  markChatRead,
  touchChat,
} from '../db/chats.js';
import { HttpError } from '../lib/http-error.js';
import { resolveAssistantTarget, streamAssistantReply } from '../services/assistant.js';
import {
  countChatMessages,
  createFact,
  getMemory,
  upsertSummary,
} from '../db/memory.js';
import { refreshMemory } from '../services/memory.js';

const chatRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ chats: listChats() }));

  app.post('/', async (req, reply) => {
    const input = chatCreateSchema.parse(req.body);
    if ('kind' in input && input.kind === 'group') {
      const group = input as { title: string; characterIds: string[] };
      const unique = [...new Set(group.characterIds)];
      if (unique.length < 2) throw new HttpError(400, '至少选择两个不同角色');
      for (const id of unique) {
        if (!getCharacter(id)) throw new HttpError(404, '角色不存在');
      }
      const result = createGroupChat(group.title, unique);
      return reply.code(201).send(result);
    }
    const character = getCharacter((input as { characterId: string }).characterId);
    if (!character) throw new HttpError(404, '角色不存在');
    const result = createChatForCharacter(character);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const chat = getChat(id);
    if (!chat) throw new HttpError(404, '会话不存在');
    return { chat };
  });

  app.get('/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    const query = req.query as { limit?: string; before?: string };
    const limit = Number(query.limit ?? 30);
    const before = query.before ? Number(query.before) : undefined;
    return listMessages(
      id,
      Number.isFinite(limit) ? limit : 30,
      before && Number.isFinite(before) ? before : undefined,
    );
  });

  app.get('/:id/memory', async (req) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    return { memory: getMemory(id) };
  });

  app.post('/:id/memory/refresh', async (req) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    const memory = await refreshMemory(id);
    return { memory };
  });

  app.patch('/:id/memory', async (req) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    const input = summaryPatchSchema.parse(req.body);
    const summary = upsertSummary(id, input.summary, countChatMessages(id));
    return { summary };
  });

  app.post('/:id/facts', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    const input = factInputSchema.parse(req.body);
    const fact = createFact(id, input);
    return reply.code(201).send({ fact });
  });

  app.post('/:id/read', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');
    markChatRead(id);
    return reply.code(204).send();
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteChat(id)) throw new HttpError(404, '会话不存在');
    return reply.code(204).send();
  });

  app.post('/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = getChatRow(id);
    if (!chat) throw new HttpError(404, '会话不存在');
    if (!req.user) throw new HttpError(401, '未登录');

    const input = sendMessageSchema.parse(req.body);
    resolveAssistantTarget({ chatId: id, userText: input.content });

    const userMessage = insertMessage({
      chatId: id,
      role: 'user',
      senderId: req.user.id,
      kind: input.kind,
      content: input.content,
    });
    touchChat(id, 0);
    markChatRead(id);

    await streamAssistantReply({
      request: req,
      reply,
      chatId: id,
      userMessage,
      userText: input.content,
    });
    return reply;
  });

  app.post('/:id/regenerate', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getChatRow(id)) throw new HttpError(404, '会话不存在');

    const input = regenerateSchema.parse(req.body ?? {});
    if (input.messageId && !getMessage(input.messageId)) {
      throw new HttpError(404, '要重新生成的消息不存在');
    }

    const target = input.messageId ? getMessage(input.messageId) : getLastAssistantMessage(id);
    if (target && target.chatId !== id) throw new HttpError(400, '消息不属于该会话');
    if (target && target.role !== 'assistant') throw new HttpError(400, '只能重新生成 AI 消息');
    const lastAssistant = getLastAssistantMessage(id);
    if (target && (!lastAssistant || lastAssistant.id !== target.id)) {
      throw new HttpError(400, '只能重新生成最后一条 AI 消息');
    }
    const lastUser = getLastUserMessage(id);
    if (!target && !lastUser) throw new HttpError(400, '还没有可以重新生成的消息');

    const userText = lastUser?.content ?? '';
    const speakerId = target?.senderId;
    resolveAssistantTarget({ chatId: id, userText, speakerId });
    if (target) hardDeleteMessage(target.id);

    await streamAssistantReply({
      request: req,
      reply,
      chatId: id,
      userText,
      speakerId,
    });
    return reply;
  });
};

export default chatRoutes;
