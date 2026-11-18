import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, MessageCircle, Plus, Sparkles, Users } from 'lucide-react';
import type { ChatPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { subscribeProactive } from '../lib/events';

function formatChatTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function preview(chat: ChatPublic): string {
  if (!chat.lastMessage) return '还没有消息';
  if (chat.lastMessageKind === 'image') return '[图片]';
  const text = chat.lastMessage
    .replace(/```[\s\S]*?```/g, '[代码]')
    .replace(/[*_`#>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 80) || '还没有消息';
}

export function MessagesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatPublic[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .chats()
      .then((result) => {
        if (alive) setChats(result.chats);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof ApiError ? err.message : '加载会话失败');
        setChats([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return subscribeProactive(() => {
      void api.chats().then((result) => setChats(result.chats));
    });
  }, []);

  return (
    <div className="animate-in space-y-5">
      <section className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] tracking-[0.08em] text-[var(--muted)]">
            你好，{user?.displayName || '我'}
          </p>
          <h2 className="mt-1 font-display text-[30px] leading-[1.2] text-[var(--ink)]">
            今天想聊点什么？
          </h2>
        </div>
        <button
          className="btn btn-ghost mt-1 h-9 min-h-9 px-3 text-[11px]"
          onClick={() => navigate('/characters')}
        >
          <Plus size={13} />
          角色
        </button>
      </section>

      {error ? (
        <div className="card-solid px-4 py-3 text-[12px] text-[var(--accent-strong)]">{error}</div>
      ) : null}

      {chats === null ? (
        <div className="space-y-3">
          <div className="card h-20 animate-pulse" />
          <div className="card h-20 animate-pulse" />
        </div>
      ) : chats.length === 0 ? (
        <section className="card relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[var(--accent-soft)] blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--seal-bg)] text-[var(--seal-fg)]">
                <Sparkles size={16} />
              </span>
              <div>
                <p className="text-[14px] font-medium text-[var(--ink)]">还没有对话</p>
                <p className="mt-0.5 text-[11px] text-[var(--faint)]">先创建一个角色</p>
              </div>
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-[var(--muted)]">
              给 TA 一个名字、一段人设和开场白，就可以开始聊天。人设会进入每次对话。
            </p>
            <button className="btn btn-accent mt-4 w-full" onClick={() => navigate('/characters')}>
              创建角色
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      ) : (
        <section className="card overflow-hidden">
          {chats.map((chat, index) => (
            <button
              key={chat.id}
              className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[var(--accent-soft)] ${
                index > 0 ? 'border-t border-[var(--line)]' : ''
              }`}
              onClick={() => navigate(`/chats/${chat.id}`)}
            >
              {chat.kind === 'group' ? (
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
                  <Users size={21} />
                </div>
              ) : chat.characterAvatar ? (
                <img
                  src={chat.characterAvatar}
                  alt={chat.title}
                  className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                />
              ) : (
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[17px] font-medium text-white"
                  style={{ background: chat.characterColor }}
                >
                  {(chat.characterNickname || chat.title).slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[14px] font-medium">{chat.title}</p>
                  <span className="shrink-0 text-[9px] tabular text-[var(--faint)]">
                    {formatChatTime(chat.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] text-[var(--muted)]">{preview(chat)}</p>
                  {chat.unreadCount > 0 ? (
                    <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9px] font-medium text-white">
                      {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </section>
      )}

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-[var(--accent)]" />
            <p className="text-[13px] font-medium">M1 · 私聊</p>
          </div>
          <span className="chip">已上线</span>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--faint)]">
          流式回复、历史消息、编辑/删除/重说、图片和表情。世界书与记忆会在 M2 接入。
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]" onClick={() => navigate('/characters')}>
            管理角色
          </button>
          <button className="btn btn-quiet h-8 min-h-8 px-3 text-[11px]" onClick={() => navigate('/settings')}>
            模型设置
          </button>
        </div>
      </section>
    </div>
  );
}
