import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { STICKER_MAX_BYTES, STICKER_MAX_COUNT } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import { uploadsDir } from '../env.js';
import { getSetting, setSetting } from '../db/settings.js';
import { HttpError } from '../lib/http-error.js';

const KEY = 'stickers';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

function listStickers(): string[] {
  const value = getSetting<unknown>(KEY, []);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

const stickerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ stickers: listStickers() }));

  // 上传一张表情包：文件进 data/uploads，url 记到 settings 里
  app.post('/', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: STICKER_MAX_BYTES, files: 1 } });
    if (!file) throw new HttpError(400, '没有收到图片');
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) throw new HttpError(400, '只支持 PNG / JPEG / WebP / GIF / AVIF 图片');

    const stickers = listStickers();
    if (stickers.length >= STICKER_MAX_COUNT) {
      throw new HttpError(400, `表情包最多 ${STICKER_MAX_COUNT} 张，先删几张再传`);
    }

    const name = `${randomUUID()}${ext}`;
    try {
      await pipeline(file.file, createWriteStream(join(uploadsDir, name)));
    } catch {
      if (file.file.truncated) throw new HttpError(400, '图片太大（上限 2MB）');
      throw new HttpError(400, '保存图片失败');
    }
    if (file.file.truncated) throw new HttpError(400, '图片太大（上限 2MB）');

    const url = `/media/${name}`;
    const next = [url, ...stickers];
    setSetting(KEY, next);
    return reply.code(201).send({ url, stickers: next });
  });

  // 只从列表里移除；已经发出去的聊天图片还要用这个文件，所以不删磁盘
  app.delete('/', async (req) => {
    const { url } = req.query as { url?: string };
    if (!url) throw new HttpError(400, '缺少 url');
    const next = listStickers().filter((item) => item !== url);
    setSetting(KEY, next);
    return { stickers: next };
  });
};

export default stickerRoutes;
