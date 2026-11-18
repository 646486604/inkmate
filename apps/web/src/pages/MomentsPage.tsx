import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { MomentCommentPublic, MomentPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { subscribeMoments } from '../lib/events';

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function AuthorAvatar({ moment }: { moment: MomentPublic }) {
  if (moment.authorAvatar) {
    return (
      <img
        src={moment.authorAvatar}
        alt={moment.authorName}
        className="h-10 w-10 rounded-2xl object-cover"
      />
    );
  }
  return (
    <div
      className="grid h-10 w-10 place-items-center rounded-2xl text-[14px] font-medium text-white"
      style={{ background: moment.authorColor }}
    >
      {(moment.authorNickname || moment.authorName).slice(0, 1)}
    </div>
  );
}

function CommentRow({ comment }: { comment: MomentCommentPublic }) {
  return (
    <div className="flex items-start gap-2">
      {comment.authorAvatar ? (
        <img
          src={comment.authorAvatar}
          alt=""
          className="h-6 w-6 rounded-full object-cover"
        />
      ) : (
        <div
          className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-medium text-white"
          style={{ background: comment.authorColor }}
        >
          {(comment.authorNickname || comment.authorName).slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-[var(--muted)]">
          <span className="text-[var(--ink)]">
            {comment.authorNickname || comment.authorName}
          </span>
          <span className="ml-1.5 text-[9px] text-[var(--faint)]">
            {timeAgo(comment.createdAt)}
          </span>
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--ink)]">
          {comment.content}
        </p>
      </div>
    </div>
  );
}

export function MomentsPage() {
  const { user } = useAuth();
  const [moments, setMoments] = useState<MomentPublic[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [commenting, setCommenting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .moments({ limit: 20 })
      .then((result) => {
        if (alive) setMoments(result.moments);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载动态失败');
        if (alive) setMoments([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return subscribeMoments({
      onMoment: ({ moment }) => {
        setMoments((current) => {
          if (!current) return [moment];
          if (current.some((item) => item.id === moment.id)) return current;
          return [moment, ...current];
        });
      },
      onComment: ({ momentId, comment }) => {
        setMoments((current) =>
          current
            ? current.map((moment) => {
                if (moment.id !== momentId) return moment;
                if (moment.comments.some((item) => item.id === comment.id)) return moment;
                return { ...moment, comments: [...moment.comments, comment] };
              })
            : current,
        );
      },
    });
  }, []);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (event.target) event.target.value = '';
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      for (const file of files.slice(0, 4 - images.length)) {
        const result = await api.upload(file);
        setImages((current) => [...current, result.url].slice(0, 4));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function publish() {
    const text = content.trim();
    if (!text || posting) return;
    setPosting(true);
    setError('');
    try {
      const result = await api.createMoment({ content: text, images });
      setMoments((current) => {
        if (!current) return [result.moment];
        if (current.some((item) => item.id === result.moment.id)) return current;
        return [result.moment, ...current];
      });
      setContent('');
      setImages([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发布失败');
    } finally {
      setPosting(false);
    }
  }

  async function toggleLike(moment: MomentPublic) {
    try {
      const result = await api.likeMoment(moment.id);
      setMoments((current) =>
        current
          ? current.map((item) =>
              item.id === moment.id
                ? { ...item, likedByMe: result.liked, likeCount: result.likeCount }
                : item,
            )
          : current,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '点赞失败');
    }
  }

  async function submitComment(moment: MomentPublic) {
    const text = (commentDrafts[moment.id] ?? '').trim();
    if (!text || commenting === moment.id) return;
    setCommenting(moment.id);
    setError('');
    try {
      const result = await api.commentMoment(moment.id, { content: text });
      setMoments((current) =>
        current
          ? current.map((item) =>
              item.id === moment.id
                ? { ...item, comments: [...item.comments, result.comment] }
                : item,
            )
          : current,
      );
      setCommentDrafts((current) => ({ ...current, [moment.id]: '' }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '评论失败');
    } finally {
      setCommenting(null);
    }
  }

  async function removeMoment(moment: MomentPublic) {
    if (!window.confirm('删除这条动态？')) return;
    try {
      await api.deleteMoment(moment.id);
      setMoments((current) => current?.filter((item) => item.id !== moment.id) ?? current);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    }
  }

  return (
    <div className="animate-in space-y-5 pb-2">
      <section>
        <p className="text-[12px] text-[var(--muted)]">动态</p>
        <h2 className="mt-1 font-display text-[29px] leading-tight">TA 们的生活</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
          角色会按日程发动态。你点赞、评论，TA 会回；你也可以发一条。
        </p>
      </section>

      {error ? (
        <div className="card-solid flex items-start gap-2 px-4 py-3 text-[11px] text-[var(--accent-strong)]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--seal-bg)] text-[12px] font-medium text-[var(--seal-fg)]">
            {(user?.displayName || '我').slice(0, 1)}
          </div>
          <textarea
            className="field min-h-[72px] flex-1 resize-none text-[12px]"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="分享点什么…"
            maxLength={2000}
          />
        </div>

        {images.length > 0 ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {images.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-full rounded-xl object-cover" />
                <button
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white"
                  onClick={() => setImages((current) => current.filter((item) => item !== url))}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between">
          <button
            className="btn btn-quiet h-8 min-h-8 px-2 text-[11px]"
            disabled={uploading || images.length >= 4}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            图片
          </button>
          <input
            ref={fileRef}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            multiple
            onChange={handleFiles}
          />
          <button
            className="btn btn-accent h-8 min-h-8 px-4 text-[11px]"
            disabled={!content.trim() || posting}
            onClick={() => void publish()}
          >
            {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            发布
          </button>
        </div>
      </section>

      {loading ? (
        <div className="space-y-3">
          <div className="card h-32 animate-pulse" />
          <div className="card h-32 animate-pulse" />
        </div>
      ) : moments && moments.length > 0 ? (
        <div className="space-y-4">
          {moments.map((moment) => {
            const draft = commentDrafts[moment.id] ?? '';
            const isMine = moment.authorType === 'user';
            return (
              <article key={moment.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <AuthorAvatar moment={moment} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <p className="text-[13px] font-medium">{moment.authorName}</p>
                        {moment.authorNickname ? (
                          <span className="text-[10px] text-[var(--faint)]">
                            {moment.authorNickname}
                          </span>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[9px] text-[var(--faint)]">
                        {timeAgo(moment.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--ink)]">
                      {moment.content}
                    </p>
                    {moment.mood ? (
                      <span className="chip mt-2 inline-flex">{moment.mood}</span>
                    ) : null}
                  </div>
                  {isMine ? (
                    <button
                      className="btn btn-quiet h-6 min-h-6 px-1 text-[var(--faint)] hover:text-[var(--accent)]"
                      onClick={() => void removeMoment(moment)}
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : null}
                </div>

                {moment.images.length > 0 ? (
                  <div
                    className={`mt-3 grid gap-2 ${
                      moment.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                    }`}
                  >
                    {moment.images.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt=""
                        className="max-h-72 w-full cursor-zoom-in rounded-xl object-cover"
                        onClick={() => window.open(url, '_blank')}
                      />
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex items-center gap-4 border-t border-[var(--line)] pt-2">
                  <button
                    className={`flex items-center gap-1.5 text-[10px] ${
                      moment.likedByMe ? 'text-[var(--accent)]' : 'text-[var(--faint)]'
                    }`}
                    onClick={() => void toggleLike(moment)}
                  >
                    <Heart size={14} fill={moment.likedByMe ? 'currentColor' : 'none'} />
                    {moment.likeCount > 0 ? moment.likeCount : '赞'}
                  </button>
                  <span className="flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
                    <MessageCircle size={14} />
                    {moment.comments.length > 0 ? moment.comments.length : '评论'}
                  </span>
                </div>

                {moment.comments.length > 0 ? (
                  <div className="mt-3 space-y-2.5 rounded-xl bg-[var(--paper-strong)] px-3 py-2.5">
                    {moment.comments.map((comment) => (
                      <CommentRow key={comment.id} comment={comment} />
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="field h-8 min-h-8 flex-1 py-1 text-[11px]"
                    value={draft}
                    onChange={(event) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [moment.id]: event.target.value,
                      }))
                    }
                    placeholder="说点什么…"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void submitComment(moment);
                    }}
                  />
                  <button
                    className="btn btn-ghost h-8 min-h-8 px-3"
                    disabled={!draft.trim() || commenting === moment.id}
                    onClick={() => void submitComment(moment)}
                  >
                    {commenting === moment.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Send size={12} />
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card flex flex-col items-center px-5 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--faint)]">
            <Sparkles size={22} />
          </span>
          <p className="mt-3 text-[13px]">还没有动态</p>
          <p className="mt-1 max-w-[250px] text-[11px] leading-relaxed text-[var(--faint)]">
            角色会在日程里发动态；你也可以先发一条，看看谁来互动。
          </p>
        </div>
      )}
    </div>
  );
}
