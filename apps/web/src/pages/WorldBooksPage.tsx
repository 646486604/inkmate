import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { WorldBookEntryPublic, WorldBookPublic } from '@inkmate/shared';
import { WORLD_BOOK_CHAR_BUDGET, WORLD_BOOK_ENTRY_CONTENT_MAX } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

interface BookFormState {
  id?: string;
  name: string;
  description: string;
}

interface EntryFormState {
  id?: string;
  title: string;
  content: string;
  position: 'before' | 'after';
  enabled: boolean;
  sortOrder: number;
}

const emptyBook: BookFormState = { name: '', description: '' };
const emptyEntry: EntryFormState = {
  title: '',
  content: '',
  position: 'before',
  enabled: true,
  sortOrder: 0,
};

export function WorldBooksPage() {
  const navigate = useNavigate();
  const [books, setBooks] = useState<WorldBookPublic[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState<BookFormState | null>(null);
  const [entryForm, setEntryForm] = useState<EntryFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entryFormRef = useRef<HTMLDivElement>(null);
  const entryOpen = Boolean(entryForm);

  // 表单在页面最底部，手机上很容易看不见；打开时自动滚过去
  useEffect(() => {
    if (!entryOpen) return;
    const timer = window.setTimeout(() => {
      entryFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [entryOpen]);

  const load = useCallback(async () => {
    try {
      const result = await api.worldBooks();
      setBooks(result.worldBooks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载世界书失败');
      setBooks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = books?.find((book) => book.id === selectedId) ?? null;

  // 和 lib/llm/prompt.ts 的裁剪逻辑保持一致：按顺序累加，超出预算的条目不进提示词
  function usageFor(position: 'before' | 'after') {
    const marks = new Map<string, 'full' | 'partial' | 'dropped'>();
    let total = 0;
    for (const entry of selected?.entries ?? []) {
      if (!entry.enabled || entry.position !== position) continue;
      const text = entry.content.trim();
      if (total >= WORLD_BOOK_CHAR_BUDGET) {
        marks.set(entry.id, 'dropped');
        continue;
      }
      const used = Math.min(text.length, WORLD_BOOK_CHAR_BUDGET - total);
      marks.set(entry.id, used < text.length ? 'partial' : 'full');
      total += used;
    }
    return { total, marks };
  }

  const beforeUsage = usageFor('before');
  const afterUsage = usageFor('after');
  const budgetLabel = WORLD_BOOK_CHAR_BUDGET.toLocaleString();

  async function saveBook() {
    if (!bookForm || !bookForm.name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (bookForm.id) {
        await api.updateWorldBook(bookForm.id, {
          name: bookForm.name,
          description: bookForm.description,
        });
      } else {
        const result = await api.createWorldBook({
          name: bookForm.name,
          description: bookForm.description,
        });
        setSelectedId(result.worldBook.id);
      }
      setBookForm(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存世界书失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeBook(book: WorldBookPublic) {
    if (!window.confirm(`删除世界书「${book.name}」？条目也会一起删除。`)) return;
    setBusy(true);
    try {
      await api.deleteWorldBook(book.id);
      if (selectedId === book.id) setSelectedId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry() {
    if (!selected || !entryForm || !entryForm.content.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (entryForm.id) {
        await api.updateWorldBookEntry(selected.id, entryForm.id, {
          title: entryForm.title,
          content: entryForm.content,
          position: entryForm.position,
          enabled: entryForm.enabled,
          sortOrder: entryForm.sortOrder,
        });
      } else {
        await api.createWorldBookEntry(selected.id, {
          title: entryForm.title,
          content: entryForm.content,
          position: entryForm.position,
          enabled: entryForm.enabled,
          sortOrder: entryForm.sortOrder,
        });
      }
      setEntryForm(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存条目失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleEntry(entry: WorldBookEntryPublic) {
    if (!selected) return;
    try {
      await api.updateWorldBookEntry(selected.id, entry.id, { enabled: !entry.enabled });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新条目失败');
    }
  }

  async function toggleEntryPosition(entry: WorldBookEntryPublic) {
    if (!selected) return;
    try {
      await api.updateWorldBookEntry(selected.id, entry.id, {
        position: entry.position === 'before' ? 'after' : 'before',
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '切换位置失败');
    }
  }

  async function removeEntry(entry: WorldBookEntryPublic) {
    if (!selected || !window.confirm('删除这个条目？')) return;
    try {
      await api.deleteWorldBookEntry(selected.id, entry.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除条目失败');
    }
  }

  return (
    <div className="animate-in space-y-5 pb-2">
      <div className="flex items-center justify-between">
        <button
          className="btn btn-quiet h-8 min-h-8 px-1 text-[11px]"
          onClick={() => (selected ? setSelectedId(null) : navigate('/settings'))}
        >
          <ArrowLeft size={14} />
          {selected ? '世界书' : '我的'}
        </button>
        {!selected ? (
          <button
            className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
            onClick={() => setBookForm({ ...emptyBook })}
          >
            <Plus size={13} />
            新建
          </button>
        ) : (
          <button
            className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
            onClick={() => setEntryForm({ ...emptyEntry })}
          >
            <Plus size={13} />
            条目
          </button>
        )}
      </div>

      {error ? (
        <div className="card-solid flex items-start gap-2 px-4 py-3 text-[12px] text-[var(--accent-strong)]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      {!selected ? (
        <>
          <section>
            <p className="text-[12px] text-[var(--muted)]">世界书</p>
            <h2 className="mt-1 font-display text-[29px] leading-tight">给角色一个世界</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
              条目按「前/后」注入到人设两侧；可按角色关联多本。适合写背景、关系、称呼、规则。
              拼进提示词时「前」「后」各最多 {budgetLabel} 个字符，按排序号从小到大取，超出的不生效。
            </p>
          </section>

          {books === null ? (
            <div className="card h-28 animate-pulse" />
          ) : books.length === 0 ? (
            <div className="card flex flex-col items-center px-5 py-10 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--muted)]">
                <BookOpen size={24} strokeWidth={1.5} />
              </span>
              <p className="mt-3 text-[13px]">还没有世界书</p>
              <p className="mt-1 max-w-[250px] text-[11px] leading-relaxed text-[var(--faint)]">
                比如「学校」：作息规则、班级、常去的地方，都可以写成条目。
              </p>
              <button className="btn btn-accent mt-4" onClick={() => setBookForm({ ...emptyBook })}>
                <Sparkles size={14} />
                创建第一本
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {books.map((book) => (
                <div key={book.id} className="card overflow-hidden">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--accent-soft)]"
                    onClick={() => setSelectedId(book.id)}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
                      <BookOpen size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{book.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-[var(--faint)]">
                        {book.entries.length} 个条目
                        {book.description ? ` · ${book.description}` : ''}
                      </span>
                    </span>
                    <ChevronRight size={15} className="shrink-0 text-[var(--faint)]" />
                  </button>
                  <div className="flex items-center justify-end gap-1 border-t border-[var(--line)] px-3 py-1.5">
                    <button
                      className="btn btn-quiet h-7 min-h-7 px-2 text-[10px]"
                      onClick={() =>
                        setBookForm({
                          id: book.id,
                          name: book.name,
                          description: book.description,
                        })
                      }
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                    <button
                      className="btn btn-quiet h-7 min-h-7 px-2 text-[10px] text-[var(--faint)] hover:text-[var(--accent)]"
                      onClick={() => void removeBook(book)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <section>
            <p className="text-[12px] text-[var(--muted)]">世界书</p>
            <h2 className="mt-1 font-display text-[27px] leading-tight">{selected.name}</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              {selected.description || '还没有描述'}
            </p>
            <p className="mt-2 text-[10px] tabular leading-relaxed text-[var(--faint)]">
              前注入 {beforeUsage.total.toLocaleString()} / {budgetLabel} 字符 · 后注入{' '}
              {afterUsage.total.toLocaleString()} / {budgetLabel} 字符
            </p>
            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-ghost h-8 min-h-8 px-3 text-[10px]"
                onClick={() =>
                  setBookForm({
                    id: selected.id,
                    name: selected.name,
                    description: selected.description,
                  })
                }
              >
                <Pencil size={12} />
                编辑信息
              </button>
              <button
                className="btn btn-ghost h-8 min-h-8 px-3 text-[10px] text-[var(--accent-strong)]"
                onClick={() => void removeBook(selected)}
              >
                <Trash2 size={12} />
                删除
              </button>
            </div>
          </section>

          {selected.entries.length === 0 ? (
            <div className="card px-5 py-8 text-center">
              <p className="text-[13px]">这本世界书还是空的</p>
              <p className="mt-1 text-[11px] text-[var(--faint)]">加一条背景或规则。</p>
              <button className="btn btn-accent mt-4" onClick={() => setEntryForm({ ...emptyEntry })}>
                <Plus size={14} />
                添加条目
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {selected.entries.map((entry) => (
                <div key={entry.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[12px] font-medium">
                          {entry.title || '未命名条目'}
                        </p>
                        <button
                          type="button"
                          className="chip shrink-0 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          title="点一下切换前/后注入"
                          onClick={() => void toggleEntryPosition(entry)}
                        >
                          {entry.position === 'before' ? '前注入' : '后注入'} ⇄
                        </button>
                        {entry.enabled && (entry.position === 'before' ? beforeUsage : afterUsage).marks.get(entry.id) === 'dropped' ? (
                          <span className="chip shrink-0 text-[var(--accent-strong)]">
                            预算外·不生效
                          </span>
                        ) : null}
                        {entry.enabled && (entry.position === 'before' ? beforeUsage : afterUsage).marks.get(entry.id) === 'partial' ? (
                          <span className="chip shrink-0 text-[var(--accent-strong)]">后半被截断</span>
                        ) : null}
                        {!entry.enabled ? <span className="chip">已停用</span> : null}
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
                        {entry.content}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="btn btn-quiet h-7 min-h-7 px-1.5"
                        title={entry.enabled ? '停用' : '启用'}
                        onClick={() => void toggleEntry(entry)}
                      >
                        {entry.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button
                        className="btn btn-quiet h-7 min-h-7 px-1.5"
                        onClick={() =>
                          setEntryForm({
                            id: entry.id,
                            title: entry.title,
                            content: entry.content,
                            position: entry.position,
                            enabled: entry.enabled,
                            sortOrder: entry.sortOrder,
                          })
                        }
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="btn btn-quiet h-7 min-h-7 px-1.5 text-[var(--faint)] hover:text-[var(--accent)]"
                        onClick={() => void removeEntry(entry)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {bookForm ? (
        <div className="card-solid animate-in p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">{bookForm.id ? '编辑世界书' : '新建世界书'}</p>
            <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={() => setBookForm(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            <input
              className="field"
              value={bookForm.name}
              onChange={(event) => setBookForm({ ...bookForm, name: event.target.value })}
              placeholder="世界书名称"
              maxLength={80}
            />
            <textarea
              className="field min-h-[64px] resize-y"
              value={bookForm.description}
              onChange={(event) =>
                setBookForm({ ...bookForm, description: event.target.value })
              }
              placeholder="一句话描述（可选）"
              maxLength={500}
            />
          </div>
          <button
            className="btn btn-primary mt-4 w-full"
            disabled={!bookForm.name.trim() || busy}
            onClick={() => void saveBook()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存
          </button>
        </div>
      ) : null}

      {entryForm && selected ? (
        <div ref={entryFormRef} className="card-solid animate-in p-5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">
              {entryForm.id ? '编辑条目' : '新增条目'}
            </p>
            <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={() => setEntryForm(null)}>
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 grid gap-3">
            <input
              className="field"
              value={entryForm.title}
              onChange={(event) => setEntryForm({ ...entryForm, title: event.target.value })}
              placeholder="条目标题（可选）"
              maxLength={120}
            />

            <div>
              <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
                插入位置
              </span>
              <div className="flex gap-2">
                {(
                  [
                    ['before', '前注入 · 放在人设之前'],
                    ['after', '后注入 · 放在人设之后'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn h-9 min-h-9 flex-1 text-[10px] ${
                      entryForm.position === value ? 'btn-primary' : 'btn-ghost'
                    }`}
                    onClick={() => setEntryForm({ ...entryForm, position: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="field min-h-[140px] resize-y"
              value={entryForm.content}
              onChange={(event) => setEntryForm({ ...entryForm, content: event.target.value })}
              placeholder="背景、规则、关系、称呼……"
              maxLength={WORLD_BOOK_ENTRY_CONTENT_MAX}
            />
            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] tabular text-[var(--faint)]">
              <span>
                {entryForm.content.length.toLocaleString()} /{' '}
                {WORLD_BOOK_ENTRY_CONTENT_MAX.toLocaleString()} 字
              </span>
              <span>
                进提示词的前 / 后各 {budgetLabel} 字，超出部分忽略
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[10px] text-[var(--muted)]">排序</span>
                <input
                  className="field tabular"
                  type="number"
                  min={0}
                  max={999}
                  value={entryForm.sortOrder}
                  onChange={(event) =>
                    setEntryForm({ ...entryForm, sortOrder: Number(event.target.value) })
                  }
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-[11px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--accent)]"
                  checked={entryForm.enabled}
                  onChange={(event) =>
                    setEntryForm({ ...entryForm, enabled: event.target.checked })
                  }
                />
                启用
              </label>
            </div>
          </div>
          <button
            className="btn btn-primary mt-4 w-full"
            disabled={!entryForm.content.trim() || busy}
            onClick={() => void saveEntry()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存条目
          </button>
        </div>
      ) : null}
    </div>
  );
}
