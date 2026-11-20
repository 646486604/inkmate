import { useEffect, useState } from 'react';
import { CalendarDays, Loader2, Sparkles, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';

/**
 * 日程只显示「角色在聊天里提到过的事」，不再展示预先排好的时刻表。
 * 什么时候做什么由对话自然长出来，避免用户看到一堆还没发生的安排。
 */
export function SchedulePanel({
  characterId,
  onClose,
}: {
  characterId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .agenda(characterId)
      .then((result) => {
        if (alive) setItems(result.items);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载日程失败');
      })
      .finally(() => {
        if (alive) setItems((current) => current ?? []);
      });
    return () => {
      alive = false;
    };
  }, [characterId]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center">
      <div className="card-solid max-h-[80dvh] w-full max-w-[420px] overflow-y-auto p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <CalendarDays size={17} />
            </span>
            <div>
              <p className="text-[14px] font-medium">今天的日程</p>
              <p className="mt-0.5 text-[10px] text-[var(--faint)]">
                TA 在聊天里提到过的事
              </p>
            </div>
          </div>
          <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--accent-strong)]">
            {error}
          </div>
        ) : null}

        {items === null ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
          </div>
        ) : items.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-[var(--line-strong)] px-4 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--faint)]">
              <Sparkles size={20} />
            </span>
            <p className="mt-3 text-[12px]">今天还没提到什么安排</p>
            <p className="mt-1 max-w-[240px] text-[10px] leading-relaxed text-[var(--faint)]">
              聊天里 TA 说到“下午要开会”“晚上去买东西”这类事，会自己记进来。
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-[var(--line)] bg-[var(--card-solid)] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--ink)]"
              >
                {item}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-[9px] leading-relaxed text-[var(--faint)]">
          没有固定时刻表；排期是聊天里自然聊出来的，聊到才会记下。
        </p>
      </div>
    </div>
  );
}
