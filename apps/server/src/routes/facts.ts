import type { FastifyPluginAsync } from 'fastify';
import { factPatchSchema } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import { deleteFact, updateFact } from '../db/memory.js';
import { HttpError } from '../lib/http-error.js';

const factRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = factPatchSchema.parse(req.body);
    const fact = updateFact(id, patch);
    if (!fact) throw new HttpError(404, '记忆事实不存在');
    return { fact };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteFact(id)) throw new HttpError(404, '记忆事实不存在');
    return reply.code(204).send();
  });
};

export default factRoutes;
