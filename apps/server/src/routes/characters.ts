import type { FastifyPluginAsync } from 'fastify';
import { characterInputSchema, characterPatchSchema } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import {
  createCharacter,
  deleteCharacter,
  listCharacters,
  updateCharacter,
} from '../db/characters.js';
import { markBeatSkipped } from '../db/schedules.js';
import { HttpError } from '../lib/http-error.js';
import { getSchedule, refreshPlan, sendTestProactive } from '../services/schedule.js';
import { sendTestMoment } from '../services/moments.js';

const characterRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ characters: listCharacters() }));

  app.post('/', async (req, reply) => {
    const input = characterInputSchema.parse(req.body);
    const character = createCharacter(input);
    return reply.code(201).send({ character });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = characterPatchSchema.parse(req.body);
    const character = updateCharacter(id, patch);
    if (!character) throw new HttpError(404, '角色不存在');
    return { character };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteCharacter(id)) throw new HttpError(404, '角色不存在');
    return reply.code(204).send();
  });

  app.get('/:id/plan', async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { date?: string };
    if (!listCharacters().some((character) => character.id === id)) {
      throw new HttpError(404, '角色不存在');
    }
    return { plan: getSchedule(id, query.date) };
  });

  app.post('/:id/plan/refresh', async (req) => {
    const { id } = req.params as { id: string };
    return { plan: await refreshPlan(id) };
  });

  app.post('/:id/proactive/test', async (req) => {
    const { id } = req.params as { id: string };
    const message = await sendTestProactive(id, req.log);
    return { message };
  });

  app.post('/:id/moment/test', async (req) => {
    const { id } = req.params as { id: string };
    const moment = await sendTestMoment(id, req.log);
    return { moment };
  });

  app.post('/:id/beats/:beatId/skip', async (req, reply) => {
    const { id, beatId } = req.params as { id: string; beatId: string };
    if (!listCharacters().some((character) => character.id === id)) {
      throw new HttpError(404, '角色不存在');
    }
    markBeatSkipped(beatId);
    return reply.code(204).send();
  });
};

export default characterRoutes;
