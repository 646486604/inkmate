import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MusicSession, MusicTrack } from '@inkmate/shared';
import { api } from './api';

interface MusicPlayerValue {
  queue: MusicTrack[];
  index: number;
  current: MusicTrack | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  mode: PlayMode;
  loading: boolean;
  error: string;
  playTrack: (track: MusicTrack, nextQueue?: MusicTrack[]) => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  cycleMode: () => void;
  close: () => void;
  getPositionMs: () => number;
}

type PlayMode = 'order' | 'repeat-all' | 'repeat-one' | 'shuffle';

const MusicPlayerContext = createContext<MusicPlayerValue | null>(null);

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeRef = useRef(0);
  const positionRef = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const [queue, setQueue] = useState<MusicTrack[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const [mode, setMode] = useState<PlayMode>('order');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const current = queue[index] ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('inkmate-music');
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'play'; queue: MusicTrack[]; index: number }
        | { type: 'toggle'; playing: boolean }
        | { type: 'index'; index: number; playing: boolean }
        | { type: 'seek'; seconds: number }
        | { type: 'close' };
      if (!message || typeof message !== 'object') return;
      if (message.type === 'play') {
        setQueue(message.queue);
        setIndex(message.index);
        resumeRef.current = 0;
        positionRef.current = 0;
        setPositionMs(0);
        setPlaying(true);
      } else if (message.type === 'toggle') {
        setPlaying(message.playing);
      } else if (message.type === 'index') {
        setIndex(message.index);
        resumeRef.current = 0;
        positionRef.current = 0;
        setPositionMs(0);
        setPlaying(message.playing);
      } else if (message.type === 'seek') {
        if (audioRef.current) audioRef.current.currentTime = message.seconds;
        positionRef.current = message.seconds * 1000;
        setPositionMs(message.seconds * 1000);
      } else if (message.type === 'close') {
        setPlaying(false);
        setQueue([]);
        setIndex(0);
        positionRef.current = 0;
        setPositionMs(0);
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .musicSession()
      .then((result) => {
        if (!alive) return;
        const session = result.session;
        setQueue(session.queue);
        setIndex(session.index);
        setPositionMs(session.positionMs);
        positionRef.current = session.positionMs;
        resumeRef.current = session.positionMs;
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveSession = useCallback(
    (next: Partial<MusicSession>) => {
      void api.saveMusicSession(next).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      saveSession({
        queue,
        index,
        positionMs: Math.floor(positionRef.current),
        playing,
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [queue, index, playing, loading, saveSession]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setInterval(() => {
      if (!playing) return;
      saveSession({
        queue,
        index,
        positionMs: Math.floor(positionRef.current),
        playing,
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [playing, queue, index, loading, saveSession]);

  useEffect(() => {
    setDurationMs(0);
  }, [current?.streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.getAttribute('src') !== current.streamUrl) {
      audio.src = current.streamUrl;
      audio.load();
    }
    audio.volume = volume;
    if (playing) void audio.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [playing]);

  const playTrack = useCallback(
    (track: MusicTrack, nextQueue?: MusicTrack[]) => {
      setError('');
      const list = nextQueue ?? queue;
      const existing = list.findIndex(
        (item) => item.id === track.id && item.source === track.source,
      );
      const finalQueue = existing >= 0 ? list : [...list, track];
      const targetIndex = existing >= 0 ? existing : finalQueue.length - 1;
      if (
        currentRef.current?.id === track.id &&
        currentRef.current?.source === track.source &&
        existing >= 0
      ) {
        if (audioRef.current) audioRef.current.currentTime = 0;
        setPositionMs(0);
        positionRef.current = 0;
        setPlaying(true);
        channelRef.current?.postMessage({ type: 'play', queue: finalQueue, index: targetIndex });
        return;
      }
      setQueue(finalQueue);
      setIndex(targetIndex);
      resumeRef.current = 0;
      setPositionMs(0);
      positionRef.current = 0;
      setPlaying(true);
      channelRef.current?.postMessage({ type: 'play', queue: finalQueue, index: targetIndex });
    },
    [queue],
  );

  const togglePlay = useCallback(() => {
    if (!currentRef.current) return;
    const nextPlaying = !playing;
    setPlaying(nextPlaying);
    channelRef.current?.postMessage({ type: 'toggle', playing: nextPlaying });
  }, [playing]);

  const next = useCallback(() => {
    let targetIndex = index;
    let shouldPlay = true;
    if (mode === 'repeat-one') {
      if (audioRef.current) audioRef.current.currentTime = 0;
      positionRef.current = 0;
      setPositionMs(0);
      setPlaying(true);
      channelRef.current?.postMessage({ type: 'seek', seconds: 0 });
      void audioRef.current?.play().catch(() => undefined);
      return;
    } else if (mode === 'shuffle' && queue.length > 1) {
      while (targetIndex === index) targetIndex = Math.floor(Math.random() * queue.length);
    } else if (index + 1 < queue.length) {
      targetIndex = index + 1;
    } else if (mode === 'repeat-all' && queue.length > 0) {
      targetIndex = 0;
    } else {
      shouldPlay = false;
    }
    resumeRef.current = 0;
    positionRef.current = 0;
    setPositionMs(0);
    setPlaying(shouldPlay);
    setIndex(targetIndex);
    channelRef.current?.postMessage({ type: 'index', index: targetIndex, playing: shouldPlay });
  }, [index, mode, queue.length]);

  const previous = useCallback(() => {
    const targetIndex = Math.max(0, index - 1);
    resumeRef.current = 0;
    setPositionMs(0);
    positionRef.current = 0;
    setPlaying(true);
    setIndex(targetIndex);
    channelRef.current?.postMessage({ type: 'index', index: targetIndex, playing: true });
  }, [index]);

  const cycleMode = useCallback(() => {
    setMode((value) =>
      value === 'order'
        ? 'repeat-all'
        : value === 'repeat-all'
          ? 'repeat-one'
          : value === 'repeat-one'
            ? 'shuffle'
            : 'order',
    );
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPositionMs(seconds * 1000);
    positionRef.current = seconds * 1000;
    channelRef.current?.postMessage({ type: 'seek', seconds });
  }, []);

  const setVolume = useCallback((value: number) => {
    setVolumeState(value);
    if (audioRef.current) audioRef.current.volume = value;
  }, []);

  const close = useCallback(() => {
    setPlaying(false);
    setQueue([]);
    setIndex(0);
    setPositionMs(0);
    positionRef.current = 0;
    saveSession({ queue: [], index: 0, positionMs: 0, playing: false });
    channelRef.current?.postMessage({ type: 'close' });
  }, [saveSession]);

  const getPositionMs = useCallback(() => positionRef.current, []);

  const value = useMemo<MusicPlayerValue>(
    () => ({
      queue,
      index,
      current,
      playing,
      positionMs,
      durationMs,
      volume,
      mode,
      loading,
      error,
      playTrack,
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      cycleMode,
      close,
      getPositionMs,
    }),
    [
      queue,
      index,
      current,
      playing,
      positionMs,
      durationMs,
      volume,
      mode,
      loading,
      error,
      playTrack,
      togglePlay,
      next,
      previous,
      seek,
      setVolume,
      cycleMode,
      close,
      getPositionMs,
    ],
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onTimeUpdate={(event) => {
          const ms = event.currentTarget.currentTime * 1000;
          positionRef.current = ms;
          setPositionMs(ms);
        }}
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDurationMs(audio.duration * 1000);
          if (resumeRef.current > 0 && Number.isFinite(audio.duration)) {
            audio.currentTime = Math.min(
              resumeRef.current / 1000,
              Math.max(0, audio.duration - 0.5),
            );
            positionRef.current = audio.currentTime * 1000;
            setPositionMs(audio.currentTime * 1000);
            resumeRef.current = 0;
          }
        }}
        onEnded={next}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError('这首歌暂时无法播放（VIP / 下架 / 版权限制，或边车未启动）');
        }}
      />
    </MusicPlayerContext.Provider>
  );
}

export function useMusicPlayer(): MusicPlayerValue {
  const value = useContext(MusicPlayerContext);
  if (!value) throw new Error('useMusicPlayer must be used inside MusicPlayerProvider');
  return value;
}
