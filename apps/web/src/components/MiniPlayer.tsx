import { useLocation, useNavigate } from 'react-router-dom';
import { Music2, Pause, Play, SkipForward, X } from 'lucide-react';
import { useMusicPlayer } from '../lib/music-player';

export function MiniPlayer() {
  const { current, playing, togglePlay, next, close } = useMusicPlayer();
  const location = useLocation();
  const navigate = useNavigate();

  if (!current) return null;
  if (location.pathname === '/music' || location.pathname.startsWith('/chats/')) return null;

  return (
    <div
      className="fixed inset-x-0 z-30 mx-auto w-full max-w-[480px] px-3"
      style={{ bottom: 'calc(66px + env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card-solid)] px-3 py-2 shadow-xl backdrop-blur">
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          onClick={() => navigate('/music')}
        >
          {current.coverUrl ? (
            <img src={current.coverUrl} alt="" className="h-9 w-9 rounded-xl object-cover" />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--paper-strong)] text-[var(--accent)]">
              <Music2 size={16} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] text-[var(--ink)]">{current.title}</span>
            <span className="block truncate text-[9px] text-[var(--faint)]">
              {current.artist || '未知歌手'}
            </span>
          </span>
        </button>
        <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={togglePlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={next}>
          <SkipForward size={15} />
        </button>
        <button className="btn btn-quiet h-8 min-h-8 px-1.5" onClick={close}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
