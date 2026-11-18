import { randomUUID } from 'node:crypto';
import type {
  MusicCommentPublic,
  MusicSession,
  MusicTrack,
} from '@inkmate/shared';
import { getCharacter } from './characters.js';
import { getDb } from './index.js';

interface TrackRow {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  path: string;
  cover_path: string;
  lyrics: string;
  source: string;
  source_id: string | null;
  created_at: number;
}

interface SessionRow {
  id: string;
  state_json: string;
  updated_at: number;
}

interface CommentRow {
  id: string;
  character_id: string;
  track_id: string;
  content: string;
  created_at: number;
}

function toTrack(row: TrackRow): MusicTrack {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album,
    durationMs: row.duration_ms,
    coverUrl: row.cover_path,
    source: row.source === 'netease' ? 'netease' : 'local',
    streamUrl: `/api/music/tracks/${row.id}/stream`,
    lyrics: row.lyrics,
  };
}

export function listTracks(): MusicTrack[] {
  const rows = getDb()
    .prepare("SELECT * FROM music_tracks WHERE source = 'local' ORDER BY created_at DESC")
    .all() as unknown as TrackRow[];
  return rows.map(toTrack);
}

export function getTrack(id: string): MusicTrack | null {
  const row = getDb()
    .prepare('SELECT * FROM music_tracks WHERE id = ?')
    .get(id) as unknown as TrackRow | undefined;
  return row ? toTrack(row) : null;
}

export function getTrackRow(id: string): TrackRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM music_tracks WHERE id = ?')
      .get(id) as unknown as TrackRow | undefined) ?? null
  );
}

export function createTrack(input: {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
  path: string;
  coverPath?: string;
  lyrics?: string;
}): MusicTrack {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO music_tracks
        (id, title, artist, album, duration_ms, path, cover_path, lyrics, source, source_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'local', NULL, ?)`,
    )
    .run(
      id,
      input.title,
      input.artist ?? '',
      input.album ?? '',
      input.durationMs ?? 0,
      input.path,
      input.coverPath ?? '',
      input.lyrics ?? '',
      now,
    );
  const track = getTrack(id);
  if (!track) throw new Error('曲目保存失败');
  return track;
}

export function getSession(): MusicSession {
  const row = getDb()
    .prepare('SELECT * FROM music_sessions ORDER BY updated_at DESC LIMIT 1')
    .get() as unknown as SessionRow | undefined;
  if (!row) {
    return { queue: [], index: 0, positionMs: 0, playing: false, updatedAt: Date.now() };
  }
  try {
    const parsed = JSON.parse(row.state_json) as Partial<MusicSession>;
    return {
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      index: Number.isFinite(parsed.index) ? Number(parsed.index) : 0,
      positionMs: Number.isFinite(parsed.positionMs) ? Number(parsed.positionMs) : 0,
      playing: Boolean(parsed.playing),
      updatedAt: row.updated_at,
    };
  } catch {
    return { queue: [], index: 0, positionMs: 0, playing: false, updatedAt: row.updated_at };
  }
}

export function saveSession(session: MusicSession): MusicSession {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare('SELECT id FROM music_sessions ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined;
  const state = JSON.stringify({
    queue: session.queue,
    index: session.index,
    positionMs: session.positionMs,
    playing: session.playing,
  });
  if (existing) {
    db.prepare('UPDATE music_sessions SET state_json = ?, updated_at = ? WHERE id = ?').run(
      state,
      now,
      existing.id,
    );
  } else {
    db.prepare('INSERT INTO music_sessions (id, state_json, updated_at) VALUES (?, ?, ?)').run(
      randomUUID(),
      state,
      now,
    );
  }
  return { ...session, updatedAt: now };
}

export function addMusicComment(input: {
  characterId: string;
  trackId: string;
  content: string;
}): MusicCommentPublic | null {
  const character = getCharacter(input.characterId);
  if (!character) return null;
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO music_comments (id, character_id, track_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, input.characterId, input.trackId, input.content, now);
  return {
    id,
    characterId: character.id,
    characterName: character.name,
    characterNickname: character.nickname,
    characterAvatar: character.avatar,
    characterColor: character.color,
    trackId: input.trackId,
    content: input.content,
    createdAt: now,
  };
}

export function listMusicComments(trackId: string, limit = 20): MusicCommentPublic[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM music_comments WHERE track_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(trackId, Math.min(50, Math.max(1, limit))) as unknown as CommentRow[];
  return rows
    .reverse()
    .map((row) => {
      const character = getCharacter(row.character_id);
      return {
        id: row.id,
        characterId: row.character_id,
        characterName: character?.name ?? '已删除角色',
        characterNickname: character?.nickname ?? '',
        characterAvatar: character?.avatar ?? '',
        characterColor: character?.color ?? '#b4472f',
        trackId: row.track_id,
        content: row.content,
        createdAt: row.created_at,
      };
    });
}

export function listFavoriteTracks(): MusicTrack[] {
  const rows = getDb()
    .prepare('SELECT track_json FROM music_favorites ORDER BY created_at DESC')
    .all() as unknown as Array<{ track_json: string }>;
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.track_json) as MusicTrack;
      } catch {
        return null;
      }
    })
    .filter((track): track is MusicTrack => Boolean(track?.id && track?.streamUrl));
}

export function toggleFavorite(track: MusicTrack): { favorited: boolean } {
  const existing = getDb()
    .prepare('SELECT 1 AS yes FROM music_favorites WHERE track_id = ?')
    .get(track.id);
  if (existing) {
    getDb().prepare('DELETE FROM music_favorites WHERE track_id = ?').run(track.id);
    return { favorited: false };
  }
  getDb()
    .prepare('INSERT INTO music_favorites (track_id, track_json, created_at) VALUES (?, ?, ?)')
    .run(track.id, JSON.stringify(track), Date.now());
  return { favorited: true };
}
