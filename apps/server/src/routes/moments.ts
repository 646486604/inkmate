import type { FastifyPluginAsync } from 'fastify';
import {
  momentCommentInputSchema,
  momentInputSchema,
} from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import {
  addComment,
  deleteMoment,
  getMomentRow,
  listMoments,
  toggleLike,
} from '../db/moments.js';
import { HttpError } from '../lib/http-error.js';
import {
  createUserMoment,
  enqueueMomentReply,
} from '../services/moments.js';
import { publish } from '../services/events.js';

const momentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req) => {
    const query = req.query as { limit?: string; before?: string; characterId?: string };
    const limit = Number(query.limit ?? 20);
    const before = query.before ? Number(query.before) : undefined;
    return {
      moments: listMoments(
        req.user!.id,
        Number.isFinite(limit) ? limit : 20,
        before && Number.isFinite(before) ? before : undefined,
        query.characterId || undefined,
      ),
    };
  });

  app.post('/', async (req, reply) => {
    const input = momentInputSchema.parse(req.body);
    const moment = await createUserMoment(req.user!.id, input.content, input.images);
    return reply.code(201).send({ moment });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const moment = getMomentRow(id);
    if (!moment) throw new HttpError(404, '动态不存在');
    if (moment.author_type !== 'user' || moment.author_id !== req.user!.id) {
      throw new HttpError(403, '只能删除自己的动态');
    }
    deleteMoment(id);
    return reply.code(204).send();
  });

  app.post('/:id/like', async (req) => {
    const { id } = req.params as { id: string };
    if (!getMomentRow(id)) throw new HttpError(404, '动态不存在');
    return toggleLike(id, req.user!.id);
  });

  app.post('/:id/comments', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getMomentRow(id)) throw new HttpError(404, '动态不存在');
    const input = momentCommentInputSchema.parse(req.body);
    const comment = addComment({
      momentId: id,
      authorType: 'user',
      authorId: req.user!.id,
      content: input.content,
    });
    enqueueMomentReply(id);
    publish('moment_comment', { momentId: id, comment });
    return reply.code(201).send({ comment });
  });
};

export default momentRoutes;
