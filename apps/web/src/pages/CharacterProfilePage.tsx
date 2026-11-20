import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Heart, Loader2, MessageCircle, Send, Sparkles, Trash2 } from 'lucide-react';
import type { CharacterPublic, MomentPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function CharacterProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const chatId = search.get('chatId') ?? '';
  const navigate = useNavigate();
  const [character, setCharacter] = useState<CharacterPublic | null>(null);
  const [moments, setMoments] = useState<MomentPublic[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [error, setError] = useState('');
  const [commentOpenId, setCommentOpenId] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [likeBusyId, setLikeBusyId] = useState('');
  const commentRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api.characters(),
      api.moments(
        chatId
          ? { chatId, limit: 30 }
          : { characterId: id, limit: 30 },
      ),
    ])
      .then(([charactersResult, momentsResult]) => {
        if (!alive) return;
        setCharacter(charactersResult.characters.find((item) => item.id === id) ?? null);
        setMoments(momentsResult.moments);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载角色失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, chatId]);

  async function startChat() {
    if (starting) return;
    if (chatId) {
      navigate(`/chats/${chatId}`);
      return;
    }
    if (!character) return;
    setStarting(true);
    setError('');
    try {
      const result = await api.createChat(character.id);
      navigate(`/chats/${result.chat.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '打开会话失败');
    } finally {
      setStarting(false);
    }
  }

  function replaceMoment(next: MomentPublic) {
    setMoments((current) =>
      current ? current.map((item) => (item.id === next.id ? next : item)) : current,
    );
  }

  async function toggleLike(moment: MomentPublic) {
    if (likeBusyId) return;
    setLikeBusyId(moment.id);
    try {
      const result = await api.likeMoment(moment.id);
      replaceMoment({
        ...moment,
        likedByMe: result.liked,
        likeCount: result.likeCount,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败');
    } finally {
      setLikeBusyId('');
    }
  }

  async function removeMoment(moment: MomentPublic) {
    if (!window.confirm('删除这条动态？下面的评论和点赞会一起删掉。')) return;
    try {
      await api.deleteMoment(moment.id);
      setMoments((current) => current?.filter((item) => item.id !== moment.id) ?? current);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    }
  }

  async function sendComment(moment: MomentPublic) {
    const content = commentDraft.trim();
    if (!content || commentBusy) return;
    setCommentBusy(true);
    setError('');
    try {
      const result = await api.commentMoment(moment.id, { content });
      replaceMoment({ ...moment, comments: [...moment.comments, result.comment] });
      setCommentDraft('');
      commentRef.current?.focus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '评论失败');
    } finally {
      setCommentBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="app-frame flex min-h-dvh items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
      </div>
    );
  }

  if (!character) {
    return (
      <div className="app-frame flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[13px]">角色不存在</p>
        <button className="btn btn-ghost" onClick={() => navigate('/characters')}>
          回到角色列表
        </button>
      </div>
    );
  }

  const avatar = character.avatar?.trim();
  const personaText = character.persona.trim();

  return (
    <div className="app-frame flex min-h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button className="btn btn-quiet h-9 min-h-9 px-1" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <p className="min-w-0 flex-1 truncate text-[14px] font-medium">角色主页</p>
      </header>

      <main className="flex-1 space-y-5 px-5 pb-8 pt-5">
        {error ? (
          <div className="card-solid px-4 py-3 text-[11px] text-[var(--accent-strong)]">{error}</div>
        ) : null}

        <section className="flex items-start gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="h-20 w-20 shrink-0 rounded-3xl object-cover" />
          ) : (
            <div
              className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-[26px] font-medium text-white"
              style={{ background: character.color }}
            >
              {character.name.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-[24px] leading-tight">{character.name}</h2>
            {character.nickname ? (
              <p className="mt-1 truncate text-[11px] text-[var(--faint)]">{character.nickname}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[var(--faint)]">
              <span className="chip">{character.memoryLimit} 轮记忆</span>
              <span className="chip">
                {character.initiative.enabled ? '会主动找你' : '不主动'}
              </span>
            </div>
          </div>
        </section>

        <button
          className="btn btn-primary w-full"
          disabled={starting}
          onClick={() => void startChat()}
        >
          {starting ? <Loader2 size={15} className="animate-spin" /> : <MessageCircle size={15} />}
          {chatId ? '回到聊天' : '开始聊天'}
        </button>

        <section className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium">人设</p>
            {personaText.length > 80 ? (
              <button
                className="text-[10px] text-[var(--faint)]"
                onClick={() => setPersonaOpen((open) => !open)}
              >
                {personaOpen ? '收起' : '展开'}
              </button>
            ) : null}
          </div>
          <p
            className={`mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--muted)] ${
              personaOpen ? '' : 'line-clamp-3'
            }`}
          >
            {personaText || '还没有写人设'}
          </p>
          {character.greeting.trim() ? (
            <>
              <div className="hairline my-3" />
              <p className="text-[11px] leading-relaxed text-[var(--faint)]">
                开场白：{character.greeting.trim()}
              </p>
            </>
          ) : null}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-[12px] font-medium">TA 的动态</p>
            <span className="text-[10px] text-[var(--faint)]">
              {moments ? `${moments.length} 条` : ''}
            </span>
          </div>

          {moments === null ? (
            <div className="card h-24 animate-pulse" />
          ) : moments.length === 0 ? (
            <div className="card flex flex-col items-center px-5 py-8 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--faint)]">
                <Sparkles size={20} />
              </span>
              <p className="mt-3 text-[12px]">这个聊天里还没发过动态</p>
              <p className="mt-1 text-[10px] text-[var(--faint)]">
                这里只显示当前聊天里的动态，聊天删了它们也会一起消失。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {moments.map((moment) => (
                <article key={moment.id} className="card p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] text-[var(--faint)]">
                      {formatDate(moment.createdAt)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {moment.mood ? <span className="chip">{moment.mood}</span> : null}
                      <button
                        className="rounded-lg px-1 py-0.5 text-[var(--faint)] hover:text-[var(--accent)]"
                        onClick={() => void removeMoment(moment)}
                        aria-label="删除这条动态"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed">
                    {moment.content}
                  </p>
                  {moment.images.length > 0 ? (
                    <div
                      className={`mt-2 grid gap-2 ${
                        moment.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      }`}
                    >
                      {moment.images.map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt=""
                          className="max-h-60 w-full cursor-zoom-in rounded-xl object-cover"
                          onClick={() => window.open(url, '_blank')}
                        />
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--faint)]">
                    <button
                      className={`flex items-center gap-1 ${moment.likedByMe ? 'text-[var(--accent)]' : ''}`}
                      onClick={() => void toggleLike(moment)}
                      disabled={likeBusyId === moment.id}
                    >
                      <Heart
                        size={12}
                        fill={moment.likedByMe ? 'currentColor' : 'none'}
                      />
                      赞 {moment.likeCount}
                    </button>
                    <button
                      className="flex items-center gap-1"
                      onClick={() => {
                        setCommentOpenId((current) => (current === moment.id ? '' : moment.id));
                        setCommentDraft('');
                      }}
                    >
                      <MessageCircle size={12} />
                      评论 {moment.comments.length}
                    </button>
                  </div>

                  {moment.comments.length > 0 ? (
                    <ul className="mt-2 space-y-1 rounded-xl bg-[var(--paper-strong)] px-3 py-2">
                      {moment.comments.map((comment) => (
                        <li key={comment.id} className="text-[11px] leading-relaxed">
                          <span className="text-[var(--accent-strong)]">
                            {comment.authorName}：
                          </span>
                          <span className="text-[var(--muted)]">{comment.content}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {commentOpenId === moment.id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        ref={commentRef}
                        className="field h-9 min-h-9 flex-1 text-[11px]"
                        value={commentDraft}
                        maxLength={200}
                        placeholder="说点什么…"
                        onChange={(event) => setCommentDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void sendComment(moment);
                          }
                        }}
                      />
                      <button
                        className="btn btn-accent h-9 min-h-9 px-3"
                        disabled={!commentDraft.trim() || commentBusy}
                        onClick={() => void sendComment(moment)}
                      >
                        {commentBusy ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Send size={13} />
                        )}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
