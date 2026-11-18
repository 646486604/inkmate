import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/session.js';
import { uploadsDir } from '../env.js';
import { HttpError } from '../lib/http-error.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/', async (req) => {
    const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!file) throw new HttpError(400, '没有收到文件');
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) throw new HttpError(400, '只支持 PNG / JPEG / WebP / GIF / AVIF 图片');

    const name = `${randomUUID()}${ext}`;
    const destination = join(uploadsDir, name);
    try {
      await pipeline(file.file, createWriteStream(destination));
    } catch (error) {
      if (file.file.truncated) throw new HttpError(400, '图片太大（上限 10MB）');
      throw error;
    }
    if (file.file.truncated) throw new HttpError(400, '图片太大（上限 10MB）');

    return { url: `/media/${name}`, mime: file.mimetype };
  });
};

export default uploadRoutes;
