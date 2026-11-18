import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/session.js';
import { uploadsDir } from '../env.js';
import { HttpError } from '../lib/http-error.js';

const MEDIA_RE = /^[0-9a-f-]+\.(png|jpe?g|webp|gif|avif)$/i;
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    if (!MEDIA_RE.test(name)) throw new HttpError(400, '文件名不合法');
    const filePath = join(uploadsDir, name);
    if (!existsSync(filePath)) throw new HttpError(404, '图片不存在');
    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    reply.type(MIME_BY_EXT[ext] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(createReadStream(filePath));
  });
};

export default mediaRoutes;
