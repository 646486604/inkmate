import { useEffect, useState } from 'react';
import {
  Brain,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { FactPublic, MemoryPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

export function MemoryPanel({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [memory, setMemory] = useState<MemoryPublic | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [newFact, setNewFact] = useState('');
  const [editingFact, setEditingFact] = useState<FactPublic | null>(null);
  const [editingContent, setEditingContent] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .memory(chatId)
      .then((result) => {
        if (!alive) return;
        setMemory(result.memory);
        setDraft(result.memory.summary?.content ?? '');
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载记忆失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [chatId]);

  function applyMemory(next: MemoryPublic) {
    setMemory(next);
    setDraft(next.summary?.content ?? '');
  }

  async function saveSummary() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.updateSummary(chatId, draft);
      setMemory((current) =>
        current
          ? {
              ...current,
              summary: result.summary,
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存摘要失败');
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      const result = await api.refreshMemory(chatId);
      applyMemory(result.memory);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '整理记忆失败');
    } finally {
      setRefreshing(false);
    }
  }

  async function addFact() {
    const content = newFact.trim();
    if (!content) return;
    setError('');
    try {
      const result = await api.createFact(chatId, { content, importance: 3 });
      setMemory((current) =>
        current
          ? { ...current, facts: [result.fact, ...current.facts] }
          : current,
      );
      setNewFact('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '添加事实失败');
    }
  }

  async function saveFact() {
    if (!editingFact) return;
    try {
      const result = await api.updateFact(editingFact.id, {
        content: editingContent.trim(),
      });
      setMemory((current) =>
        current
          ? {
              ...current,
              facts: current.facts.map((fact) =>
                fact.id === result.fact.id ? result.fact : fact,
              ),
            }
          : current,
      );
      setEditingFact(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存事实失败');
    }
  }

  async function removeFact(fact: FactPublic) {
    if (!window.confirm('删除这条记忆事实？')) return;
    try {
      await api.deleteFact(fact.id);
      setMemory((current) =>
        current ? { ...current, facts: current.facts.filter((item) => item.id !== fact.id) } : current,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    }
  }

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
              <Brain size={17} />
            </span>
            <div>
              <p className="text-[14px] font-medium">长期记忆</p>
              <p className="mt-0.5 text-[10px] text-[var(--faint)]">
                摘要 + 事实，会随每次对话注入
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

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] tracking-[0.14em] text-[var(--muted)]">摘要</p>
                <button
                  className="btn btn-ghost h-7 min-h-7 px-2 text-[10px]"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  {refreshing ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                  立即整理
                </button>
              </div>
              <textarea
                className="field min-h-[130px] resize-y text-[12px]"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="还没有摘要。聊够 20 条后会自动整理，也可以点「立即整理」。"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[9px] text-[var(--faint)]">
                  {memory?.summary
                    ? `已整理 ${memory.summary.messageCount} 条消息`
                    : '尚未生成'}
                </span>
                <button
                  className="btn btn-primary h-7 min-h-7 px-3 text-[10px]"
                  disabled={saving || draft === (memory?.summary?.content ?? '')}
                  onClick={() => void saveSummary()}
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  保存摘要
                </button>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] tracking-[0.14em] text-[var(--muted)]">
                  事实 · {memory?.facts.length ?? 0}
                </p>
                <span className="text-[9px] text-[var(--faint)]">最多 40 条</span>
              </div>

              <div className="space-y-2">
                {memory?.facts.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-3 text-[10px] text-[var(--faint)]">
                    还没有事实。可以手动加一条，或让 AI 整理。
                  </p>
                ) : null}

                {memory?.facts.map((fact) => (
                  <div key={fact.id} className="rounded-xl border border-[var(--line)] px-3 py-2">
                    {editingFact?.id === fact.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          className="field h-8 min-h-8 flex-1 py-1 text-[11px]"
                          value={editingContent}
                          onChange={(event) => setEditingContent(event.target.value)}
                        />
                        <button className="btn btn-primary h-8 min-h-8 px-2" onClick={() => void saveFact()}>
                          <Check size={12} />
                        </button>
                        <button
                          className="btn btn-quiet h-8 min-h-8 px-1"
                          onClick={() => setEditingFact(null)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] leading-relaxed text-[var(--ink)]">
                            {fact.content}
                          </p>
                          <p className="mt-1 flex items-center gap-0.5 text-[8px] text-[var(--faint)]">
                            {Array.from({ length: 5 }).map((_, index) => (
                              <span
                                key={index}
                                className={
                                  index < fact.importance
                                    ? 'text-[var(--accent)]'
                                    : 'text-[var(--line-strong)]'
                                }
                              >
                                ●
                              </span>
                            ))}
                          </p>
                        </div>
                        <button
                          className="btn btn-quiet h-6 min-h-6 px-1"
                          onClick={() => {
                            setEditingFact(fact);
                            setEditingContent(fact.content);
                          }}
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          className="btn btn-quiet h-6 min-h-6 px-1 text-[var(--faint)] hover:text-[var(--accent)]"
                          onClick={() => void removeFact(fact)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  className="field h-9 min-h-9 flex-1 py-1 text-[11px]"
                  value={newFact}
                  onChange={(event) => setNewFact(event.target.value)}
                  placeholder="手动加一条事实…"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void addFact();
                  }}
                />
                <button
                  className="btn btn-ghost h-9 min-h-9 px-3"
                  disabled={!newFact.trim()}
                  onClick={() => void addFact()}
                >
                  <Plus size={13} />
                </button>
              </div>
            </section>

            <div className="flex items-start gap-2 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-[9px] leading-relaxed text-[var(--faint)]">
              <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              自动整理每 20 条触一次，用当前角色的模型服务。摘要只记发生过的事，不重复人设；事实只记关系变动、人生轨迹这类值得记住的节点。整理失败不影响聊天。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
