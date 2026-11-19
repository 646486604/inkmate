import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { musicCommentInputSchema, type MusicSession } from '@inkmate/shared';
import { requireAuth } from '../auth/session.js';
import { musicDir } from '../env.js';
import {
  createTrack,
  getSession,
  getTrack,
  getTrackRow,
  listFavoriteTracks,
  listMusicComments,
  listTracks,
  saveSession,
  toggleFavorite,
} from '../db/music.js';
import { HttpError } from '../lib/http-error.js';
import {
  checkNeteaseAccount,
  clearNeteaseCookie,
  generateMusicComment,
  getNeteaseAccount,
  getNeteaseCookie,
  getNeteaseCookieSource,
  getNeteaseDaily,
  getNeteaseLyrics,
  getNeteasePlaylist,
  normalizeNeteaseCookie,
  pickLocalTrack,
  proxyNeteaseStream,
  saveNeteaseCookie,
  searchNetease,
} from '../services/music.js';

const neteaseCookieSchema = z.object({
  cookie: z.string().trim().min(1, 'Cookie 是空的').max(8000, 'Cookie 太长，确认只复制了 Cookie'),
});

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/flac': '.flac',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
};

function contentTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  return 'application/octet-stream';
}

const musicRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/tracks', async () => ({ tracks: listTracks() }));

  app.post('/tracks', async (req, reply) => {
    let savedName = '';
    let originalName = '';
    let title = '';
    let artist = '';
    let album = '';
    let lyrics = '';
    let durationMs = 0;

    for await (const part of req.parts({
      limits: { fileSize: 60 * 1024 * 1024, files: 1 },
    })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file') {
          part.file.resume();
          continue;
        }
        const ext = AUDIO_EXT[part.mimetype] ?? extname(part.filename ?? '').toLowerCase();
        if (!ext || !['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.webm'].includes(ext)) {
          part.file.resume();
          throw new HttpError(400, '只支持 MP3 / M4A / FLAC / WAV / OGG / WebM 音频');
        }
        savedName = `${randomUUID()}${ext}`;
        originalName = part.filename ?? '';
        await pipeline(part.file, createWriteStream(join(musicDir, savedName)));
        if (part.file.truncated) throw new HttpError(400, '音频太大（上限 60MB）');
      } else {
        const value = String(part.value ?? '');
        if (part.fieldname === 'title') title = value.slice(0, 200);
        else if (part.fieldname === 'artist') artist = value.slice(0, 200);
        else if (part.fieldname === 'album') album = value.slice(0, 200);
        else if (part.fieldname === 'lyrics') lyrics = value.replace(/^\uFEFF/, '').slice(0, 50_000);
        else if (part.fieldname === 'durationMs') durationMs = Number(value) || 0;
      }
    }

    if (!savedName) throw new HttpError(400, '没有收到音频文件');
    const fallbackTitle = originalName.replace(/\.[^.]+$/, '') || '未命名歌曲';
    const track = createTrack({
      title: title.trim() || fallbackTitle,
      artist: artist.trim(),
      album: album.trim(),
      durationMs,
      path: savedName,
      lyrics,
    });
    return reply.code(201).send({ track });
  });

  app.get('/tracks/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getTrackRow(id);
    if (!row) throw new HttpError(404, '曲目不存在');
    const filePath = join(musicDir, row.path);
    if (!existsSync(filePath)) throw new HttpError(404, '音频文件不存在');
    const stat = statSync(filePath);
    const range = req.headers.range;
    const mime = contentTypeFor(filePath);

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
        return reply.code(416).header('Content-Range', `bytes */${stat.size}`).send();
      }
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', String(end - start + 1));
      reply.header('Content-Type', mime);
      return reply.send(createReadStream(filePath, { start, end }));
    }

    reply.header('Content-Type', mime);
    reply.header('Content-Length', String(stat.size));
    reply.header('Accept-Ranges', 'bytes');
    return reply.send(createReadStream(filePath));
  });

  app.get('/tracks/:id/lyrics', async (req) => {
    const { id } = req.params as { id: string };
    const track = getTrack(id);
    if (!track) throw new HttpError(404, '曲目不存在');
    return { lyrics: track.lyrics ?? '' };
  });

  app.get('/netease/search', async (req) => {
    const query = req.query as { q?: string };
    const keyword = query.q?.trim();
    if (!keyword) return { tracks: [] };
    return { tracks: await searchNetease(keyword) };
  });

  app.get('/netease/lyrics/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { lyrics: await getNeteaseLyrics(id) };
  });

  // 网易云账号：只返回昵称/VIP 状态，永远不回传 Cookie 本身
  app.get('/netease/account', async () => ({ account: await checkNeteaseAccount() }));

  app.put('/netease/cookie', async (req) => {
    const input = neteaseCookieSchema.parse(req.body);
    const cookie = normalizeNeteaseCookie(input.cookie);
    const account = await getNeteaseAccount(cookie); // 验证通过才保存
    saveNeteaseCookie(cookie);
    return { account: { ...account, configured: true, source: 'stored' as const } };
  });

  app.delete('/netease/cookie', async () => {
    clearNeteaseCookie();
    return {
      account: getNeteaseCookie()
        ? { configured: true, source: getNeteaseCookieSource() ?? undefined }
        : { configured: false },
    };
  });

  app.get('/netease/daily', async () => ({ tracks: await getNeteaseDaily() }));

  app.get('/netease/playlist/:id', async (req) => {
    const { id } = req.params as { id: string };
    return { tracks: await getNeteasePlaylist(id) };
  });

  app.get('/netease/stream/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { response } = await proxyNeteaseStream(id, req.headers.range);
    if (!response.body) throw new HttpError(502, '音频源没有返回内容');
    reply.code(response.status === 206 ? 206 : 200);
    for (const header of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
    ]) {
      const value = response.headers.get(header);
      if (value) reply.header(header, value);
    }
    if (!response.headers.get('accept-ranges')) reply.header('Accept-Ranges', 'bytes');
    return reply.send(Readable.fromWeb(response.body as never));
  });

  app.get('/session', async () => ({ session: getSession() }));

  app.get('/favorites', async () => ({ tracks: listFavoriteTracks() }));

  app.post('/favorites', async (req) => {
    const body = req.body as { track?: unknown };
    const track = body.track as {
      id?: string;
      title?: string;
      artist?: string;
      album?: string;
      durationMs?: number;
      coverUrl?: string;
      source?: string;
      streamUrl?: string;
      lyrics?: string;
    };
    if (!track?.id || !track.title || !track.streamUrl) {
      throw new HttpError(400, '曲目信息不完整');
    }
    return toggleFavorite({
      id: track.id,
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      durationMs: track.durationMs ?? 0,
      coverUrl: track.coverUrl ?? '',
      source: track.source === 'netease' ? 'netease' : 'local',
      streamUrl: track.streamUrl,
      lyrics: track.lyrics,
    });
  });

  app.patch('/session', async (req) => {
    const input = req.body as Partial<MusicSession>;
    const current = getSession();
    const queue = Array.isArray(input.queue) ? input.queue.slice(0, 100) : current.queue;
    const next: MusicSession = {
      queue,
      index: Math.min(Math.max(0, Number(input.index ?? current.index)), Math.max(0, queue.length - 1)),
      positionMs: Math.max(0, Number(input.positionMs ?? current.positionMs)),
      playing: Boolean(input.playing ?? current.playing),
      updatedAt: Date.now(),
    };
    return { session: saveSession(next) };
  });

  app.post('/comments', async (req) => {
    const input = musicCommentInputSchema.parse(req.body);
    return { comment: await generateMusicComment(input) };
  });

  app.get('/comments', async (req) => {
    const query = req.query as { trackId?: string };
    if (!query.trackId) return { comments: [] };
    return { comments: listMusicComments(query.trackId) };
  });

  app.post('/pick', async (req) => {
    const input = req.body as { characterId?: string };
    if (!input.characterId) throw new HttpError(400, '请选择角色');
    return pickLocalTrack(input.characterId);
  });
};

export default musicRoutes;
