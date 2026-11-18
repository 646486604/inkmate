import { useEffect, useState } from 'react';
import {
  CalendarDays,
  Check,
  Loader2,
  RefreshCw,
  Send,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';
import type { DayPlanPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusLabel(status: string): string {
  if (status === 'sent') return '已发';
  if (status === 'skipped') return '已跳过';
  if (status === 'missed') return '已错过';
  return '等待';
}

export function SchedulePanel({
  characterId,
  onClose,
}: {
  characterId: string;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<DayPlanPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const result = await api.schedule(characterId);
      setPlan(result.plan);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载日程失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    api
      .schedule(characterId)
      .then((result) => {
        if (alive) setPlan(result.plan);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载日程失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [characterId]);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.refreshPlan(characterId);
      setPlan(result.plan);
      setNotice('今天的日程已重新生成');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '生成日程失败');
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.testProactive(characterId);
      setNotice(`已发一条：${result.message.content.slice(0, 80)}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function skip(beatId: string) {
    try {
      await api.skipBeat(characterId, beatId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '跳过失败');
    }
  }

  const now = Date.now();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-0 backdrop-blur-[2px] sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[88dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--paper)] p-5 shadow-2xl sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <CalendarDays size={17} />
            </span>
            <div>
              <p className="text-[14px] font-medium">今天的日程</p>
              <p className="mt-0.5 text-[10px] text-[var(--faint)]">
                TA 会在这些节拍里决定要不要找你
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
        {notice ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 text-[10px] leading-relaxed text-[var(--muted)]">
            <Check size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <span className="break-words">{notice}</span>
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
          </div>
        ) : plan ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card-solid)] p-4">
              <div className="flex items-center gap-2">
                <span className="chip">{plan.dayType || '日常'}</span>
                <span className="text-[11px] text-[var(--muted)]">心情：{plan.mood || '平常'}</span>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink)]">
                {plan.summary || '今天没有写摘要。'}
              </p>
            </div>

            <div className="space-y-2">
              {plan.beats.map((beat) => {
                const isNow = beat.startAt <= now && (!beat.endAt || beat.endAt > now);
                return (
                  <div
                    key={beat.id}
                    className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
                      isNow
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--line)]'
                    }`}
                  >
                    <div className="w-10 shrink-0 pt-0.5 text-[10px] tabular text-[var(--faint)]">
                      {formatTime(beat.startAt)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-[11px] text-[var(--ink)]">{beat.activity}</p>
                        {beat.contactWorthy ? (
                          <span className="chip">
                            <Sparkles size={9} />
                            联系点
                          </span>
                        ) : null}
                        {beat.status !== 'pending' ? (
                          <span className="text-[9px] text-[var(--faint)]">
                            {statusLabel(beat.status)}
                          </span>
                        ) : null}
                      </div>
                      {beat.contactIntent ? (
                        <p className="mt-1 text-[9px] leading-relaxed text-[var(--faint)]">
                          想：{beat.contactIntent}
                        </p>
                      ) : null}
                    </div>
                    {beat.contactWorthy && beat.status === 'pending' ? (
                      <button
                        className="btn btn-quiet h-6 min-h-6 shrink-0 px-1.5 text-[9px]"
                        title="跳过这个联系点"
                        onClick={() => void skip(beat.id)}
                      >
                        <SkipForward size={11} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-ghost flex-1 text-[11px]"
                disabled={busy}
                onClick={() => void refresh()}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                重新生成
              </button>
              <button
                className="btn btn-primary flex-1 text-[11px]"
                disabled={busy}
                onClick={() => void testSend()}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                现在发一条
              </button>
            </div>
            <p className="text-[9px] leading-relaxed text-[var(--faint)]">
              「现在发一条」会绕过时间与免打扰，用来验收主动消息；不会计入当天已发数量。
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--line-strong)] px-4 py-8 text-center">
            <CalendarDays size={24} className="mx-auto text-[var(--faint)]" />
            <p className="mt-3 text-[12px]">今天还没有日程</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
              开启主动消息后，角色会在每天固定时间自己生成；也可以手动生成一份。
            </p>
            <button
              className="btn btn-accent mt-4"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              生成今天日程
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
