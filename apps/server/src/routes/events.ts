import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/session.js';
import { subscribe, unsubscribe } from '../services/events.js';

const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireAuth }, async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    subscribe(reply);
    const close = () => unsubscribe(reply);
    reply.raw.on('close', close);
  });
};

export default eventRoutes;
