import type { FastifyPluginAsync } from 'fastify';
import {
  worldBookEntryInputSchema,
  worldBookEntryPatchSchema,
  worldBookInputSchema,
  worldBookPatchSchema,
} from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import {
  createWorldBook,
  createWorldBookEntry,
  deleteWorldBook,
  deleteWorldBookEntry,
  getWorldBook,
  listWorldBooks,
  updateWorldBook,
  updateWorldBookEntry,
} from '../db/world-books.js';
import { HttpError } from '../lib/http-error.js';

const worldBookRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ worldBooks: listWorldBooks() }));

  app.get('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const worldBook = getWorldBook(id);
    if (!worldBook) throw new HttpError(404, '世界书不存在');
    return { worldBook };
  });

  app.post('/', async (req, reply) => {
    const input = worldBookInputSchema.parse(req.body);
    const worldBook = createWorldBook(input);
    return reply.code(201).send({ worldBook });
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = worldBookPatchSchema.parse(req.body);
    const worldBook = updateWorldBook(id, patch);
    if (!worldBook) throw new HttpError(404, '世界书不存在');
    return { worldBook };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteWorldBook(id)) throw new HttpError(404, '世界书不存在');
    return reply.code(204).send();
  });

  app.post('/:id/entries', async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = worldBookEntryInputSchema.parse(req.body);
    const entry = createWorldBookEntry(id, input);
    if (!entry) throw new HttpError(404, '世界书不存在');
    return reply.code(201).send({ entry });
  });

  app.patch('/:id/entries/:entryId', async (req) => {
    const { id, entryId } = req.params as { id: string; entryId: string };
    const patch = worldBookEntryPatchSchema.parse(req.body);
    const entry = updateWorldBookEntry(id, entryId, patch);
    if (!entry) throw new HttpError(404, '条目不存在');
    return { entry };
  });

  app.delete('/:id/entries/:entryId', async (req, reply) => {
    const { id, entryId } = req.params as { id: string; entryId: string };
    if (!deleteWorldBookEntry(id, entryId)) throw new HttpError(404, '条目不存在');
    return reply.code(204).send();
  });
};

export default worldBookRoutes;
