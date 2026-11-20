import type {
  CharacterPublic,
  MusicCommentPublic,
  MusicTrack,
  NeteaseAccountPublic,
} from '@inkmate/shared';
import { createHash } from 'node:crypto';
import { getCharacter } from '../db/characters.js';
import { getPrimaryUser } from '../db/users.js';
import { listTracks } from '../db/music.js';
import { addMusicComment } from '../db/music.js';
import { getPrivateChatForCharacter } from '../db/chats.js';
import { getMemory } from '../db/memory.js';
import { getSetting, setSetting } from '../db/settings.js';
import { neteaseApiUrl } from '../env.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { HttpError } from '../lib/http-error.js';
import { completeChat } from '../llm/complete.js';
import { resolveProviderForCharacter } from '../llm/resolve.js';
import { getScheduleContext } from './schedule.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) InkMate/0.1';
const NETEASE_COOKIE_KEY = 'netease_cookie_enc';

function readStoredCookie(): string {
  const stored = getSetting<unknown>(NETEASE_COOKIE_KEY, '');
  if (typeof stored !== 'string' || !stored) return '';
  try {
    return decryptSecret(stored).trim();
  } catch {
    return '';
  }
}

/** 数据目录里的 Cookie 优先；没存过才用环境变量，方便无 UI 的部署。 */
export function getNeteaseCookie(): string {
  return readStoredCookie() || (process.env.NETEASE_COOKIE ?? '').trim();
}

export function getNeteaseCookieSource(): 'stored' | 'env' | null {
  if (readStoredCookie()) return 'stored';
  if ((process.env.NETEASE_COOKIE ?? '').trim()) return 'env';
  return null;
}

/** 接受整条 Cookie、带 "Cookie:" 前缀、带换行/引号的粘贴；至少要有 MUSIC_U。 */
export function normalizeNeteaseCookie(input: string): string {
  let value = input.trim();
  if (!value) throw new HttpError(400, 'Cookie 是空的');
  value = value.replace(/^cookie\s*:\s*/i, '');
  value = value.replace(/[\r\n\t]+/g, ' ');
  value = value.replace(/^["'`]+|["'`]+$/g, '').trim();
  // 从某些文档/URL 复制过来时是整条 encodeURIComponent 过的
  if (!value.includes('=') && /%3D/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // 解不开就按原样继续，下面会报缺少 MUSIC_U
    }
  }

  const pairs = new Map<string, string>();
  for (const chunk of value.split(';')) {
    const part = chunk.trim();
    if (!part) continue;
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const val = part.slice(index + 1).trim();
    if (!key || !val) continue;
    pairs.set(key, val);
  }

  if (!pairs.has('MUSIC_U')) {
    throw new HttpError(400, '没有找到 MUSIC_U，确认复制的是 music.163.com 的完整 Cookie');
  }
  if ((pairs.get('MUSIC_U') ?? '').length < 10) {
    throw new HttpError(400, 'MUSIC_U 看起来不完整，重新复制整条 Cookie');
  }
  return [...pairs.entries()].map(([key, val]) => `${key}=${val}`).join('; ');
}

export function saveNeteaseCookie(cookie: string): void {
  setSetting(NETEASE_COOKIE_KEY, encryptSecret(cookie));
}

export function clearNeteaseCookie(): void {
  setSetting(NETEASE_COOKIE_KEY, '');
}

async function neteaseGet(
  path: string,
  cookieOverride?: string,
): Promise<Record<string, unknown>> {
  const cookie = cookieOverride ?? getNeteaseCookie();
  // Cookie 放在请求头里，不放进 URL：边车会记录 req.originalUrl，query 里的 Cookie 会明文落日志。
  // `_ink` 是 Cookie 的短哈希，只用于把边车 2 分钟 URL 缓存按账号隔开。
  const tag = cookie ? createHash('sha1').update(cookie).digest('hex').slice(0, 12) : 'anon';
  const separator = path.includes('?') ? '&' : '?';
  const target = `${path}${separator}_ink=${tag}`;
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
  };
  if (cookie) headers.Cookie = cookie;

  let response: Response;
  try {
    response = await fetch(`${neteaseApiUrl}${target}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(
      503,
      '网易云边车没有启动。先运行 NeteaseCloudMusicApi（默认 127.0.0.1:3000），或改用本地曲库。',
    );
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const failedCode = typeof data?.code === 'number' ? data.code : null;
    if (failedCode === 460 || failedCode === -460) {
      throw new HttpError(429, '网易云触发了风控，先歇十分钟再听；本地曲库不受影响。');
    }
    throw new HttpError(502, `网易云边车返回 ${response.status}`);
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new HttpError(502, '网易云边车返回了非 JSON 内容');

  // 边车把网易云的业务错误也放在 200 里，这里显式区分，避免“看起来加载成功但没歌”。
  const code = typeof data.code === 'number' ? data.code : null;
  if (code === 460 || code === -460) {
    throw new HttpError(429, '网易云触发了风控，先歇十分钟再听；本地曲库不受影响。');
  }
  if (code === 301) {
    throw new HttpError(401, '网易云登录失效或未登录，请重新粘贴 Cookie。');
  }

  return data;
}

interface NeteaseProfile {
  userId?: number;
  nickname?: string;
  vipType?: number;
}

export async function getNeteaseAccount(
  cookie = getNeteaseCookie(),
): Promise<NeteaseAccountPublic> {
  if (!cookie) return { configured: false };
  const data = await neteaseGet('/user/account', cookie);
  const profile = data.profile as NeteaseProfile | null | undefined;
  if (!profile) {
    throw new HttpError(401, '网易云 Cookie 无效或已过期，请重新复制');
  }
  return {
    configured: true,
    nickname: profile.nickname ?? '',
    userId: profile.userId,
    vipType: profile.vipType ?? 0,
    source: getNeteaseCookieSource() ?? undefined,
  };
}

export async function checkNeteaseAccount(): Promise<NeteaseAccountPublic> {
  const cookie = getNeteaseCookie();
  if (!cookie) return { configured: false };
  try {
    return await getNeteaseAccount(cookie);
  } catch (error) {
    return {
      configured: true,
      source: getNeteaseCookieSource() ?? undefined,
      error: error instanceof HttpError ? error.message : '检查网易云账号失败',
    };
  }
}

interface NeteaseSong {
  id?: number;
  name?: string;
  artists?: Array<{ name?: string }>;
  ar?: Array<{ name?: string }>;
  album?: { name?: string; picUrl?: string };
  al?: { name?: string; picUrl?: string };
  duration?: number;
  dt?: number;
}

function mapNeteaseSong(song: NeteaseSong): MusicTrack | null {
  if (!song.id || !song.name) return null;
  const artists = song.artists ?? song.ar ?? [];
  const album = song.album ?? song.al;
  return {
    id: String(song.id),
    title: song.name,
    artist: artists.map((artist) => artist.name).filter(Boolean).join(' / '),
    album: album?.name ?? '',
    durationMs: song.duration ?? song.dt ?? 0,
    coverUrl: album?.picUrl ?? '',
    source: 'netease' as const,
    streamUrl: `/api/music/netease/stream/${song.id}`,
  };
}

function mapNeteaseSongs(songs: NeteaseSong[]): MusicTrack[] {
  return songs.map(mapNeteaseSong).filter((track): track is MusicTrack => Boolean(track));
}

export async function searchNetease(keyword: string, limit = 20): Promise<MusicTrack[]> {
  const data = await neteaseGet(
    `/search?keywords=${encodeURIComponent(keyword)}&limit=${Math.min(30, limit)}&type=1`,
  );
  const result = data.result as { songs?: NeteaseSong[] } | undefined;
  return mapNeteaseSongs(result?.songs ?? []);
}

export async function getNeteasePlaylist(id: string): Promise<MusicTrack[]> {
  const data = await neteaseGet(`/playlist/track/all?id=${encodeURIComponent(id)}&limit=500`);
  const songs = data.songs as NeteaseSong[] | undefined;
  if (!songs) throw new HttpError(404, '歌单不存在或没有歌曲');
  return mapNeteaseSongs(songs);
}

export async function getNeteaseDaily(): Promise<MusicTrack[]> {
  const data = await neteaseGet('/recommend/songs');
  const payload = data.data as { dailySongs?: NeteaseSong[] } | undefined;
  return mapNeteaseSongs(payload?.dailySongs ?? []);
}

export async function getNeteaseLyrics(id: string): Promise<string> {
  const data = await neteaseGet(`/lyric?id=${encodeURIComponent(id)}`);
  const lrc = data.lrc as { lyric?: string } | undefined;
  return lrc?.lyric ?? '';
}

export async function resolveNeteaseStream(id: string): Promise<string> {
  // 新版 /song/url/v1 在不少网络环境会直接返回 -460（网络环境风险），
  // 而旧的 /song/url 仍能正常取到 320k/128k 地址；优先用旧接口，失败再降码率。
  const attempts = ['br=320000', 'br=128000'];
  for (const query of attempts) {
    const data = await neteaseGet(
      `/song/url?id=${encodeURIComponent(id)}&${query}`,
    );
    const list = data.data as Array<{ url?: string | null }> | undefined;
    const url = list?.[0]?.url;
    if (url) return url;
  }
  throw new HttpError(404, '这首歌暂时无法播放（VIP/下架/版权限制）');
}

export async function proxyNeteaseStream(
  id: string,
  range: string | undefined,
): Promise<{ response: Response; url: string }> {
  const url = await resolveNeteaseStream(id);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://music.163.com/',
        ...(range ? { Range: range } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, '拉取网易云音频失败');
  }
  if (!response.ok && response.status !== 206) {
    throw new HttpError(502, `音频源返回 ${response.status}`);
  }
  return { response, url };
}

function buildCommentPrompt(
  character: CharacterPublic,
  input: {
    title: string;
    artist: string;
    positionMs: number;
    reason: string;
    lyric: string;
  },
): string {
  const chat = getPrivateChatForCharacter(character.id);
  const memory = chat ? getMemory(chat.id) : null;
  const schedule = getScheduleContext(character.id);
  const user = getPrimaryUser();
  const mm = Math.floor(input.positionMs / 60_000);
  const ss = String(Math.floor((input.positionMs % 60_000) / 1000)).padStart(2, '0');

  return [
    `你在「墨伴」里扮演「${character.name}」（${character.nickname || character.name}），正和${user?.displayName || '我'}一起听歌。`,
    `人设：${character.persona.slice(0, 1500) || '自然、真诚。'}`,
    '',
    `歌曲：《${input.title}》${input.artist ? ` — ${input.artist}` : ''}`,
    `播放到 ${mm}:${ss}，场景：${input.reason}`,
    input.lyric ? `当前歌词：${input.lyric}` : '',
    schedule ? `你今天的安排/心情：${schedule.mood}；${schedule.current?.activity ?? schedule.summary}` : '',
    memory?.summary?.content ? `你们最近的记忆：${memory.summary.content.slice(0, 500)}` : '',
    '',
    '写一句你此刻想对 TA 说的话，像微信消息，1 句，不超过 40 字。',
    '不要解释、不要提 AI、不要复述歌词、不要写旁白；如果此刻没什么可说，输出 <skip>。',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateMusicComment(input: {
  characterId: string;
  trackId: string;
  title: string;
  artist?: string;
  positionMs?: number;
  reason?: string;
  lyric?: string;
}): Promise<MusicCommentPublic> {
  const character = getCharacter(input.characterId);
  if (!character) throw new HttpError(404, '角色不存在');
  const config = resolveProviderForCharacter(character);
  const raw = await completeChat(
    config,
    [
      { role: 'system', content: '你是一个正在听歌的角色，只输出一句自然的短评。' },
      {
        role: 'user',
        content: buildCommentPrompt(character, {
          title: input.title,
          artist: input.artist ?? '',
          positionMs: input.positionMs ?? 0,
          reason: input.reason ?? 'start',
          lyric: input.lyric ?? '',
        }),
      },
    ],
    { maxTokens: 120, temperature: 0.9 },
  );
  const text = raw.trim().replace(/^["“]|["”]$/g, '');
  if (!text || text.toLowerCase().includes('<skip>')) {
    throw new HttpError(502, '这次没有想说的，再听一会儿');
  }
  const comment = addMusicComment({
    characterId: character.id,
    trackId: input.trackId,
    content: text.slice(0, 200),
  });
  if (!comment) throw new HttpError(500, '保存评论失败');
  return comment;
}

export function pickLocalTrack(characterId: string): { track: MusicTrack; character: CharacterPublic } {
  const character = getCharacter(characterId);
  if (!character) throw new HttpError(404, '角色不存在');
  const tracks = listTracks();
  if (tracks.length === 0) throw new HttpError(400, '本地曲库是空的，先上传一首歌');
  const track = tracks[Math.floor(Math.random() * tracks.length)];
  if (!track) throw new HttpError(404, '没有可播放的歌');
  return { track, character };
}
