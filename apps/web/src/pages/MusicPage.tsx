import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Disc3,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import type {
  CharacterPublic,
  MusicCommentPublic,
  MusicTrack,
} from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { useMusicPlayer } from '../lib/music-player';

interface LyricLine {
  time: number;
  text: string;
}

function parseLrc(raw: string): LyricLine[] {
  if (!raw.trim()) return [];
  const lines: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    if (matches.length === 0) continue;
    const text = line.replace(/\[[^\]]+\]/g, '').trim();
    if (!text) continue;
    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0')}`) : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function activeLyricIndex(lines: LyricLine[], current: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if ((lines[i]?.time ?? 0) <= current) index = i;
    else break;
  }
  return index;
}

export function MusicPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const commentState = useRef({ count: 0, lastAt: 0, trackId: '' });
  const {
    queue,
    index,
    current,
    playing,
    positionMs,
    durationMs,
    volume,
    mode,
    error: playerError,
    playTrack,
    togglePlay,
    next,
    previous,
    seek,
    setVolume,
    cycleMode,
    getPositionMs,
  } = useMusicPlayer();

  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [characters, setCharacters] = useState<CharacterPublic[]>([]);
  const [characterId, setCharacterId] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [comments, setComments] = useState<MusicCommentPublic[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [playlistInput, setPlaylistInput] = useState('');
  const [listLabel, setListLabel] = useState('');
  const [favorites, setFavorites] = useState<MusicTrack[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'library' | 'search' | 'favorites'>('library');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [upload, setUpload] = useState({ title: '', artist: '', lyrics: '' });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([api.musicTracks(), api.characters(), api.musicFavorites()])
      .then(([trackResult, characterResult, favoriteResult]) => {
        if (!alive) return;
        setTracks(trackResult.tracks);
        setCharacters(characterResult.characters);
        setCharacterId((currentId) => currentId || characterResult.characters[0]?.id || '');
        setFavorites(favoriteResult.tracks);
        setFavoriteIds(new Set(favoriteResult.tracks.map((track) => track.id)));
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载一起听失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!current) {
      setLyrics('');
      setComments([]);
      return;
    }
    setLyrics(current.lyrics ?? '');
    setComments([]);
    commentState.current = { count: 0, lastAt: 0, trackId: current.id };
    void api.musicComments(current.id).then((result) => {
      setComments(result.comments);
      commentState.current.count = result.comments.length;
    });
    if (current.source === 'netease' && !current.lyrics) {
      void api
        .neteaseLyrics(current.id)
        .then((result) => setLyrics(result.lyrics))
        .catch(() => undefined);
    }
  }, [current?.id]);

  const lyricLines = parseLrc(lyrics);
  const lyricIndex = activeLyricIndex(lyricLines, positionMs / 1000);

  async function makeComment(reason: 'start' | 'chorus' | 'change' | 'manual') {
    if (!current || !characterId) return;
    if (commentState.current.count >= 4) return;
    if (reason !== 'manual' && Date.now() - commentState.current.lastAt < 20_000) return;
    commentState.current.lastAt = Date.now();
    const at = getPositionMs();
    const lines = parseLrc(lyrics);
    const lineIndex = activeLyricIndex(lines, at / 1000);
    try {
      const result = await api.musicComment({
        characterId,
        trackId: current.id,
        title: current.title,
        artist: current.artist,
        positionMs: Math.floor(at),
        reason,
        lyric: lineIndex >= 0 ? (lines[lineIndex]?.text ?? '') : '',
      });
      setComments((existing) => [...existing, result.comment]);
      commentState.current.count += 1;
    } catch {
      // 听歌时评论失败不打断播放
    }
  }

  useEffect(() => {
    if (!playing || !current || !characterId) return;
    const timer = window.setTimeout(() => void makeComment('start'), 1200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current?.id, characterId]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (commentState.current.count >= 4) return;
      if (getPositionMs() > 8000) void makeComment('chorus');
    }, 25_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, current?.id, characterId]);

  async function search() {
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    setError('');
    try {
      const result = await api.neteaseSearch(searchQuery.trim());
      setSearchResults(result.tracks);
      setListLabel(`搜索：${searchQuery.trim()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '搜索失败');
    } finally {
      setSearching(false);
    }
  }

  async function loadDaily() {
    if (searching) return;
    setSearching(true);
    setError('');
    try {
      const result = await api.neteaseDaily();
      setSearchResults(result.tracks);
      setListLabel('每日推荐');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '每日推荐加载失败');
    } finally {
      setSearching(false);
    }
  }

  async function loadPlaylist() {
    const raw = playlistInput.trim();
    if (!raw || searching) return;
    const match = /(?:id=)?(\d{3,})/.exec(raw);
    const id = match?.[1];
    if (!id) {
      setError('请输入网易云歌单 ID 或含 id= 的链接');
      return;
    }
    setSearching(true);
    setError('');
    try {
      const result = await api.neteasePlaylist(id);
      setSearchResults(result.tracks);
      setListLabel(`歌单 ${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '歌单加载失败');
    } finally {
      setSearching(false);
    }
  }

  async function pick() {
    if (!characterId) return;
    try {
      const result = await api.pickTrack(characterId);
      const nextQueue = [...queue, result.track];
      playTrack(result.track, nextQueue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '选歌失败');
    }
  }

  async function uploadTrack() {
    if (!uploadFile || uploading) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', uploadFile);
      form.append('title', upload.title || uploadFile.name.replace(/\.[^.]+$/, ''));
      form.append('artist', upload.artist);
      form.append('lyrics', upload.lyrics);
      const result = await api.uploadMusic(form);
      setTracks((currentTracks) => [result.track, ...currentTracks]);
      setUpload({ title: '', artist: '', lyrics: '' });
      setUploadFile(null);
      if (fileRef.current) fileRef.current.value = '';
      playTrack(result.track, [...queue, result.track]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function toggleFavoriteTrack(track: MusicTrack) {
    try {
      const result = await api.toggleMusicFavorite(track);
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (result.favorited) next.add(track.id);
        else next.delete(track.id);
        return next;
      });
      setFavorites((current) =>
        result.favorited
          ? [track, ...current.filter((item) => item.id !== track.id)]
          : current.filter((item) => item.id !== track.id),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '收藏失败');
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {    const file = event.target.files?.[0] ?? null;
    setUploadFile(file);
    if (file && !upload.title) {
      setUpload((currentUpload) => ({
        ...currentUpload,
        title: file.name.replace(/\.[^.]+$/, ''),
      }));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
      </div>
    );
  }

  const displayError = error || playerError;

  return (
    <div className="animate-in space-y-5 pb-2">
      <section>
        <p className="text-[12px] text-[var(--muted)]">一起听</p>
        <h2 className="mt-1 font-display text-[29px] leading-tight">和 TA 听同一首歌</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
          歌词同步、AI 短评、点歌。音乐从网易云来，本地文件兜底。
        </p>
      </section>

      {displayError ? (
        <div className="card-solid px-4 py-3 text-[11px] text-[var(--accent-strong)]">
          {displayError}
        </div>
      ) : null}

      <section className="card relative overflow-hidden p-4">
        <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[var(--accent-soft)] blur-2xl" />
        <div className="relative flex items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
            {current?.coverUrl ? (
              <img src={current.coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Disc3 size={34} className={playing ? 'spin-slow' : ''} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-medium">
              {current?.title ?? '还没有在听的歌'}
            </p>
            <p className="mt-1 truncate text-[10px] text-[var(--faint)]">
              {current ? [current.artist, current.album].filter(Boolean).join(' · ') : '从下面选一首'}
            </p>
            <input
              className="mt-2 w-full accent-[var(--accent)]"
              type="range"
              min={0}
              max={Math.max(1, Math.floor((durationMs || current?.durationMs || 0) / 1000))}
              value={Math.min(
                Math.floor(positionMs / 1000),
                Math.max(1, Math.floor((durationMs || current?.durationMs || 0) / 1000)),
              )}
              onChange={(event) => seek(Number(event.target.value))}
              disabled={!current}
            />
            <div className="mt-1 flex justify-between text-[9px] tabular text-[var(--faint)]">
              <span>{formatDuration(positionMs)}</span>
              <span>{formatDuration(durationMs || current?.durationMs || 0)}</span>
            </div>
          </div>
        </div>

        <div className="relative mt-3 flex items-center justify-center gap-4">
          <button className="btn btn-quiet h-9 min-h-9 px-2" onClick={previous} disabled={!current}>
            <SkipBack size={18} />
          </button>
          <button
            className="btn btn-accent h-11 min-h-11 w-11 rounded-full px-0"
            onClick={togglePlay}
            disabled={!current}
          >
            {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
          </button>
          <button className="btn btn-quiet h-9 min-h-9 px-2" onClick={next} disabled={!current}>
            <SkipForward size={18} />
          </button>
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            title={`播放模式：${mode}`}
            onClick={cycleMode}
            disabled={!current}
          >
            {mode === 'shuffle' ? (
              <Shuffle size={16} />
            ) : mode === 'repeat-one' ? (
              <Repeat1 size={16} />
            ) : mode === 'repeat-all' ? (
              <Repeat size={16} />
            ) : (
              <ListMusic size={16} />
            )}
          </button>
          <div className="ml-2 flex items-center gap-1.5">
            <Volume2 size={14} className="text-[var(--faint)]" />
            <input
              className="w-16 accent-[var(--accent)]"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
              }}
            />
          </div>
          <button
            className={`btn btn-quiet h-9 min-h-9 px-2 ${
              current && favoriteIds.has(current.id) ? 'text-[var(--accent)]' : ''
            }`}
            disabled={!current}
            title="收藏"
            onClick={() => current && void toggleFavoriteTrack(current)}
          >
            <Heart
              size={16}
              fill={current && favoriteIds.has(current.id) ? 'currentColor' : 'none'}
            />
          </button>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          className={`btn h-8 min-h-8 flex-1 text-[11px] ${tab === 'library' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('library')}
        >
          曲库
        </button>
        <button
          className={`btn h-8 min-h-8 flex-1 text-[11px] ${tab === 'search' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('search')}
        >
          网易云
        </button>
        <button
          className={`btn h-8 min-h-8 flex-1 text-[11px] ${tab === 'favorites' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setTab('favorites')}
        >
          收藏
        </button>
      </div>

      {tab === 'library' ? (
        <section className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium">本地曲库 · {tracks.length}</p>
            <button
              className="btn btn-quiet h-7 min-h-7 px-2 text-[10px]"
              onClick={() => setUploadFile(null)}
            >
              <Upload size={12} />
              <span className="ml-1">上传</span>
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {tracks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[10px] text-[var(--faint)]">
                本地还没有歌。下面可以上传。
              </p>
            ) : null}
            {tracks.map((track, trackIndex) => (
              <button
                key={track.id}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--accent-soft)]"
                onClick={() => playTrack(track)}
              >
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--paper-strong)] text-[10px] tabular text-[var(--faint)]">
                  {String(trackIndex + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{track.title}</span>
                  <span className="block truncate text-[9px] text-[var(--faint)]">
                    {track.artist || '未知歌手'}
                  </span>
                </span>
                <span className="text-[9px] tabular text-[var(--faint)]">
                  {formatDuration(track.durationMs)}
                </span>
                {current?.id === track.id ? <Music2 size={13} className="text-[var(--accent)]" /> : null}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-[var(--line)] pt-3">
            <p className="text-[10px] text-[var(--muted)]">上传本地歌曲</p>
            <div className="mt-2 grid gap-2">
              <input
                ref={fileRef}
                className="field py-1 text-[10px]"
                type="file"
                accept="audio/mpeg,audio/mp4,audio/flac,audio/wav,audio/ogg,audio/webm"
                onChange={handleFile}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="field h-9 min-h-9 py-1 text-[11px]"
                  value={upload.title}
                  onChange={(event) => setUpload({ ...upload, title: event.target.value })}
                  placeholder="歌名"
                />
                <input
                  className="field h-9 min-h-9 py-1 text-[11px]"
                  value={upload.artist}
                  onChange={(event) => setUpload({ ...upload, artist: event.target.value })}
                  placeholder="歌手"
                />
              </div>
              <textarea
                className="field min-h-[48px] text-[10px]"
                value={upload.lyrics}
                onChange={(event) => setUpload({ ...upload, lyrics: event.target.value })}
                placeholder="LRC 歌词（可选）"
              />
              <button
                className="btn btn-ghost h-8 min-h-8 text-[10px]"
                disabled={!uploadFile || uploading}
                onClick={() => void uploadTrack()}
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                上传并播放
              </button>
            </div>
          </div>
        </section>
      ) : tab === 'search' ? (
        <section className="card p-4">
          <div className="flex gap-2">
            <input
              className="field h-9 min-h-9 flex-1 py-1 text-[11px]"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void search();
              }}
              placeholder="搜索网易云歌曲"
            />
            <button className="btn btn-accent h-9 min-h-9 px-3" disabled={searching} onClick={() => void search()}>
              {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn btn-ghost h-8 min-h-8 shrink-0 px-2 text-[10px]"
              disabled={searching}
              onClick={() => void loadDaily()}
            >
              <Sparkles size={11} />
              每日推荐
            </button>
            <input
              className="field h-8 min-h-8 flex-1 py-1 text-[10px]"
              value={playlistInput}
              onChange={(event) => setPlaylistInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void loadPlaylist();
              }}
              placeholder="歌单 ID / 链接"
            />
            <button
              className="btn btn-ghost h-8 min-h-8 shrink-0 px-2 text-[10px]"
              disabled={searching}
              onClick={() => void loadPlaylist()}
            >
              导入
            </button>
          </div>
          {listLabel ? (
            <p className="mt-3 text-[9px] text-[var(--faint)]">{listLabel} · {searchResults.length} 首</p>
          ) : null}
          <div className="mt-2 space-y-2">
            {searchResults.map((track) => (
              <button
                key={track.id}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[var(--accent-soft)]"
                onClick={() => playTrack(track, [...queue, track])}
              >
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--paper-strong)]">
                    <Music2 size={14} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px]">{track.title}</span>
                  <span className="block truncate text-[9px] text-[var(--faint)]">
                    {track.artist || '未知歌手'}
                  </span>
                </span>
                <Play size={13} className="text-[var(--accent)]" />
              </button>
            ))}
            {searchResults.length === 0 && !searching ? (
              <p className="py-4 text-center text-[10px] text-[var(--faint)]">
                输入关键词搜索；需要本机网易云边车。
              </p>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="card p-4">
          <p className="text-[12px] font-medium">我的收藏 · {favorites.length}</p>
          <div className="mt-3 space-y-2">
            {favorites.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-4 text-center text-[10px] text-[var(--faint)]">
                在播放器上点心形收藏一首。
              </p>
            ) : null}
            {favorites.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-[var(--accent-soft)]"
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => playTrack(track)}
                >
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--paper-strong)]">
                      <Music2 size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{track.title}</span>
                    <span className="block truncate text-[9px] text-[var(--faint)]">
                      {track.artist || '未知歌手'}
                    </span>
                  </span>
                </button>
                <button
                  className="btn btn-quiet h-7 min-h-7 px-1.5 text-[var(--accent)]"
                  onClick={() => void toggleFavoriteTrack(track)}
                >
                  <Heart size={13} fill="currentColor" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card p-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-medium">歌词</p>
          <span className="text-[9px] text-[var(--faint)]">
            {lyricLines.length > 0 ? `${lyricIndex + 1}/${lyricLines.length}` : '暂无'}
          </span>
        </div>
        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
          {lyricLines.length === 0 ? (
            <p className="py-4 text-center text-[10px] text-[var(--faint)]">这首歌没有歌词。</p>
          ) : (
            lyricLines.map((line, lineIndex) => (
              <p
                key={`${line.time}-${lineIndex}`}
                className={`text-[11px] leading-relaxed transition ${
                  lineIndex === lyricIndex
                    ? 'font-medium text-[var(--accent)]'
                    : 'text-[var(--faint)]'
                }`}
              >
                {line.text}
              </p>
            ))
          )}
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-medium">AI 陪伴</p>
          <div className="flex items-center gap-1.5">
            <select
              className="field h-7 min-h-7 max-w-[120px] px-2 py-0 text-[10px]"
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
            >
              <option value="">选择角色</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.nickname || character.name}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost h-7 min-h-7 px-2 text-[10px]" onClick={() => void pick()}>
              <Sparkles size={11} />
              选歌
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {comments.length === 0 ? (
            <p className="text-[10px] text-[var(--faint)]">开始播放后，TA 会偶尔说一句。</p>
          ) : null}
          {comments.map((comment) => (
            <div key={comment.id} className="flex items-start gap-2">
              {comment.characterAvatar ? (
                <img src={comment.characterAvatar} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-medium text-white"
                  style={{ background: comment.characterColor }}
                >
                  {(comment.characterNickname || comment.characterName).slice(0, 1)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-[var(--faint)]">
                  {comment.characterNickname || comment.characterName}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ink)]">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn btn-ghost mt-3 w-full text-[10px]"
          disabled={!current || !characterId || comments.length >= 4}
          onClick={() => void makeComment('manual')}
        >
          {comments.length >= 4 ? '这首已经聊够了' : '让 TA 现在说一句'}
        </button>
      </section>

      {queue.length > 0 ? (
        <section className="card p-4">
          <p className="text-[12px] font-medium">播放队列</p>
          <div className="mt-3 space-y-1.5">
            {queue.map((track, queueIndex) => (
              <button
                key={`${track.source}-${track.id}`}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] ${
                  queueIndex === index ? 'bg-[var(--accent-soft)]' : ''
                }`}
                onClick={() => playTrack(track)}
              >
                <span className="w-5 tabular text-[var(--faint)]">
                  {String(queueIndex + 1).padStart(2, '0')}
                </span>
                <span className="truncate">{track.title}</span>
                <span className="ml-auto shrink-0 text-[9px] text-[var(--faint)]">
                  {track.source === 'netease' ? '网易云' : '本地'}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
