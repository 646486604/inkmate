import type { FastifyPluginAsync } from 'fastify';
import {
  chatCreateSchema,
  chatIdentitySchema,
  factInputSchema,
  regenerateSchema,
  sendBatchSchema,
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
  insertMessage,
  listChats,
  listMessages,
  markChatRead,
  touchChat,
  updateChatIdentity,
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

  // 会话级「我」的身份：不同角色面前可以是不同的人
  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const input = chatIdentitySchema.parse(req.body);
    const chat = updateChatIdentity(id, input);
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

    const meta: Record<string, unknown> = {};
    if (input.description) meta.description = input.description;
    if (input.durationSeconds !== undefined) meta.durationSeconds = input.durationSeconds;
    if (input.amount !== undefined) meta.amount = input.amount;
    if (input.sticker) meta.sticker = true;

    const userMessage = insertMessage({
      chatId: id,
      role: 'user',
      senderId: req.user.id,
      kind: input.kind,
      content: input.content,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
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

  // 攒了好几条一起发：先按顺序插入全部用户消息，再只生成一条回复
  app.post('/:id/messages/batch', async (req, reply) => {
    const { id } = req.params as { id: string };
    const chat = getChatRow(id);
    if (!chat) throw new HttpError(404, '会话不存在');
    if (!req.user) throw new HttpError(401, '未登录');

    const input = sendBatchSchema.parse(req.body);
    const items: Array<{
      kind: 'text' | 'image' | 'desc-image' | 'voice' | 'red-packet';
      content: string;
      description?: string;
      sticker?: boolean;
      durationSeconds?: number;
      amount?: number;
    }> =
      input.items && input.items.length > 0
        ? input.items
        : (input.contents ?? []).map((content) => ({ kind: 'text' as const, content }));
    const userText = items
      .map((item) => (item.kind === 'image' ? '[图片]' : item.content))
      .join('\n');
    resolveAssistantTarget({ chatId: id, userText });

    // 同一毫秒插入的多条消息会拿到相同的 created_at，排序就乱了；
    // 这里按顺序给每一条留 1ms，保证「先攒的先显示」
    const base = Date.now();
    const inserted = items.map((item, index) => {
      const meta: Record<string, unknown> = {};
      if (item.description) meta.description = item.description;
      if (item.sticker) meta.sticker = true;
      if (item.durationSeconds !== undefined) meta.durationSeconds = item.durationSeconds;
      if (item.amount !== undefined) meta.amount = item.amount;
      return insertMessage({
        chatId: id,
        role: 'user',
        senderId: req.user!.id,
        kind: item.kind,
        content: item.content,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
        createdAt: base + index,
      });
    });
    touchChat(id, 0);
    markChatRead(id);

    await streamAssistantReply({
      request: req,
      reply,
      chatId: id,
      userMessages: inserted,
      userText,
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

    await streamAssistantReply({
      request: req,
      reply,
      chatId: id,
      userText,
      speakerId,
      // 不再先删旧消息：等新回复生成成功后再替换，失败就原样保留
      replaceMessageId: target?.id,
    });
    return reply;
  });
};

export default chatRoutes;
