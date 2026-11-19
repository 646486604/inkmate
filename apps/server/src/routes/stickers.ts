import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { STICKER_MAX_BYTES, STICKER_MAX_COUNT, type StickerPublic } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import { uploadsDir } from '../env.js';
import { HttpError } from '../lib/http-error.js';
import { listStickers, saveStickers } from '../services/stickers.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const stickerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ stickers: listStickers() }));

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

    const sticker: StickerPublic = { url: `/media/${name}`, desc: '' };
    const next = [sticker, ...stickers];
    saveStickers(next);
    return reply.code(201).send({ sticker, stickers: next });
  });

  // 改描述：AI 靠它决定什么时候发这张
  app.patch('/', async (req) => {
    const body = req.body as { url?: unknown; desc?: unknown };
    if (typeof body.url !== 'string') throw new HttpError(400, '缺少 url');
    const desc = typeof body.desc === 'string' ? body.desc.trim().slice(0, 60) : '';
    const next = listStickers().map((item) =>
      item.url === body.url ? { ...item, desc } : item,
    );
    saveStickers(next);
    return { stickers: next };
  });

  // 只从列表里移除；已经发出去的聊天图片还要用这个文件，所以不删磁盘
  app.delete('/', async (req) => {
    const { url } = req.query as { url?: string };
    if (!url) throw new HttpError(400, '缺少 url');
    const next = listStickers().filter((item) => item.url !== url);
    saveStickers(next);
    return { stickers: next };
  });
};

export default stickerRoutes;
