import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUp,
  Brain,
  CalendarDays,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  SkipForward,
  Smile,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMemberPublic, ChatPublic, MessagePublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { streamAssistant } from '../lib/chat-stream';
import { useAuth } from '../lib/auth';
import { subscribeProactive } from '../lib/events';
import { useMusicPlayer } from '../lib/music-player';
import { MemoryPanel } from '../components/MemoryPanel';
import { SchedulePanel } from '../components/SchedulePanel';

const EMOJIS = [
  '😀', '😊', '🥺', '😭', '😡', '🙃', '😴', '🤔',
  '❤️', '🌙', '✨', '☕', '🍜', '🐶', '🐱', '🌧️',
  '🎧', '📚', '👀', '🙈', '💤', '🫠', '🥹', '🌿',
];

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function shouldShowTime(previous: MessagePublic | undefined, current: MessagePublic): boolean {
  if (!previous) return true;
  return current.createdAt - previous.createdAt > 5 * 60 * 1000;
}

function upsert(list: MessagePublic[], message: MessagePublic): MessagePublic[] {
  const index = list.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    const next = [...list];
    next[index] = message;
    return next;
  }
  return [...list, message].sort((a, b) => a.createdAt - b.createdAt);
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    current: musicTrack,
    playing: musicPlaying,
    togglePlay: toggleMusic,
    next: nextMusic,
  } = useMusicPlayer();
  const [chat, setChat] = useState<ChatPublic | null>(null);
  const [messages, setMessages] = useState<MessagePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [streaming, setStreaming] = useState<{ text: string; createdAt: number } | null>(null);
  const [streamingSpeaker, setStreamingSpeaker] = useState<ChatMemberPublic | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([api.chat(id), api.messages(id, { limit: 30 })])
      .then(([chatResult, messageResult]) => {
        if (!alive) return;
        setChat(chatResult.chat);
        setMessages(messageResult.messages);
        setHasMore(messageResult.hasMore);
        void api.markRead(id);
        requestAnimationFrame(() => {
          const element = scrollRef.current;
          if (element) element.scrollTop = element.scrollHeight;
        });
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : '加载会话失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 180;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    if (!id) return;
    return subscribeProactive((event) => {
      if (event.chatId !== id) return;
      setMessages((current) => upsert(current, event.message));
      void api.markRead(id);
    });
  }, [id]);

  async function loadOlder() {
    if (!id || loadingMore || !messages[0]) return;
    setLoadingMore(true);
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    try {
      const result = await api.messages(id, { limit: 30, before: messages[0].createdAt });
      setMessages((current) => [...result.messages, ...current]);
      setHasMore(result.hasMore);
      requestAnimationFrame(() => {
        if (element) element.scrollTop = element.scrollHeight - previousHeight;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载历史失败');
    } finally {
      setLoadingMore(false);
    }
  }

  async function refreshMessages() {
    if (!id) return;
    try {
      const result = await api.messages(id, { limit: 30 });
      setMessages(result.messages);
      setHasMore(result.hasMore);
    } catch {
      // ignore refresh errors; the user can retry manually
    }
  }

  function beginStream() {
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setError('');
    return controller;
  }

  function finishStream() {
    setStreaming(null);
    setStreamingSpeaker(null);
    setSending(false);
    abortRef.current = null;
    if (id) void api.markRead(id);
  }

  async function sendText() {
    const content = input.trim();
    if (!id || !content || sending) return;

    if (editing) {
      try {
        const result = await api.editMessage(editing.id, content);
        setMessages((current) => upsert(current, result.message));
        setEditing(null);
        setInput('');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '保存失败');
      }
      return;
    }

    setInput('');
    setEmojiOpen(false);
    const controller = beginStream();
    try {
      await streamAssistant(
        `/api/chats/${id}/messages`,
        { content, kind: 'text' },
        {
          onStart: (data) => {
            if (data.userMessage) setMessages((current) => upsert(current, data.userMessage!));
            setStreamingSpeaker(data.speaker ?? null);
            setStreaming({ text: '', createdAt: data.createdAt });
          },
          onDelta: (text) =>
            setStreaming((current) =>
              current ? { ...current, text: current.text + text } : current,
            ),
          onDone: (data) => {
            setMessages((current) => upsert(current, data.message));
            if (data.error) setError(data.error);
            finishStream();
          },
          onError: (message) => {
            setError(message);
            finishStream();
            void refreshMessages();
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError ? err.message : '发送失败');
        setInput(content);
      }
      finishStream();
    }
  }

  async function sendImage(file: File) {
    if (!id || sending) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = await api.upload(file);
      const controller = beginStream();
      try {
        await streamAssistant(
          `/api/chats/${id}/messages`,
          { content: uploaded.url, kind: 'image' },
          {
            onStart: (data) => {
              if (data.userMessage) setMessages((current) => upsert(current, data.userMessage!));
              setStreamingSpeaker(data.speaker ?? null);
              setStreaming({ text: '', createdAt: data.createdAt });
            },
            onDelta: (text) =>
              setStreaming((current) =>
                current ? { ...current, text: current.text + text } : current,
              ),
            onDone: (data) => {
              setMessages((current) => upsert(current, data.message));
              if (data.error) setError(data.error);
              finishStream();
            },
            onError: (message) => {
              setError(message);
              finishStream();
              void refreshMessages();
            },
          },
          controller.signal,
        );
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof ApiError ? err.message : '发送图片失败');
        }
        finishStream();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(null);
    setStreamingSpeaker(null);
    setSending(false);
    window.setTimeout(() => void refreshMessages(), 500);
  }

  async function regenerate(messageId?: string) {
    if (!id || sending) return;
    setActionId(null);
    setMessages((current) => {
      if (messageId) return current.filter((message) => message.id !== messageId);
      const lastAssistant = [...current].reverse().find((message) => message.role === 'assistant');
      return lastAssistant ? current.filter((message) => message.id !== lastAssistant.id) : current;
    });
    const controller = beginStream();
    setStreaming({ text: '', createdAt: Date.now() });
    setStreamingSpeaker(null);
    try {
      await streamAssistant(
        `/api/chats/${id}/regenerate`,
        messageId ? { messageId } : {},
        {
          onStart: (data) => {
            setStreamingSpeaker(data.speaker ?? null);
          },
          onDelta: (text) =>
            setStreaming((current) =>
              current ? { ...current, text: current.text + text } : current,
            ),
          onDone: (data) => {
            setMessages((current) => upsert(current, data.message));
            if (data.error) setError(data.error);
            finishStream();
          },
          onError: (message) => {
            setError(message);
            finishStream();
            void refreshMessages();
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof ApiError ? err.message : '重新生成失败');
        void refreshMessages();
      }
      finishStream();
    }
  }

  async function removeMessage(message: MessagePublic) {
    if (!window.confirm('删除这条消息？')) return;
    try {
      const result = await api.deleteMessage(message.id);
      setMessages((current) => upsert(current, result.message));
      setActionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    }
  }

  async function removeChat() {
    if (!id || !window.confirm('删除整个会话？所有消息都会消失。')) return;
    try {
      await api.deleteChat(id);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除会话失败');
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendText();
    }
  }

  function pickEmoji(emoji: string) {
    setInput((current) => current + emoji);
    inputRef.current?.focus();
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void sendImage(file);
  }

  const isGroup = chat?.kind === 'group';
  const characterName = isGroup
    ? chat?.title ?? '群聊'
    : chat?.characterNickname || chat?.characterName || '聊天';
  const memberCount = chat?.members.length ?? 0;
  const streamSpeakerName = streamingSpeaker
    ? streamingSpeaker.nickname || streamingSpeaker.name
    : characterName;
  const streamSpeakerAvatar =
    streamingSpeaker?.avatar || (isGroup ? '' : chat?.characterAvatar || '');
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && !message.deletedAt)?.id;

  if (loading) {
    return (
      <div className="app-frame flex min-h-dvh items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[var(--faint)]" />
      </div>
    );
  }

  return (
    <div className="app-frame flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+14px)]">
        <button className="btn btn-quiet h-9 min-h-9 px-1" onClick={() => navigate('/')}>
          <ArrowLeft size={18} />
        </button>
        {isGroup ? (
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--accent)]">
            <Users size={17} />
          </div>
        ) : chat?.characterAvatar ? (
          <img
            src={chat.characterAvatar}
            alt={characterName}
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <div
            className="grid h-9 w-9 place-items-center rounded-full text-[14px] font-medium text-white"
            style={{ background: chat?.characterColor ?? '#b4472f' }}
          >
            {characterName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{characterName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--faint)]">
            {!isGroup ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
            {isGroup ? `${memberCount} 人` : '在线'}
          </p>
        </div>
        <div className="relative">
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen ? (
            <div className="card-solid absolute right-0 top-11 z-30 w-40 overflow-hidden p-1 text-[12px] shadow-xl">
              {!isGroup ? (
                <>
                  <button
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                    onClick={() => {
                      setScheduleOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <CalendarDays size={12} className="mr-1.5 inline" />
                    今天的日程
                  </button>
                  <button
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                    onClick={() => {
                      setMemoryOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <Brain size={12} className="mr-1.5 inline" />
                    长期记忆
                  </button>
                </>
              ) : null}
              <button
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                onClick={() => navigate('/characters')}
              >
                角色设置
              </button>
              <button
                className="block w-full rounded-lg px-3 py-2 text-left text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                onClick={() => void removeChat()}
              >
                删除会话
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {musicTrack ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1.5">
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => navigate('/music')}
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--card-solid)] text-[var(--accent)]">
              <Music2 size={13} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] text-[var(--ink)]">{musicTrack.title}</span>
              <span className="block truncate text-[8px] text-[var(--faint)]">
                {musicTrack.artist || '未知歌手'}
              </span>
            </span>
          </button>
          <button className="btn btn-quiet h-7 min-h-7 px-1.5" onClick={toggleMusic}>
            {musicPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button className="btn btn-quiet h-7 min-h-7 px-1.5" onClick={nextMusic}>
            <SkipForward size={13} />
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--accent-strong)]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')}>
            <X size={13} />
          </button>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {hasMore ? (
          <div className="mb-4 text-center">
            <button
              className="btn btn-quiet h-8 min-h-8 px-3 text-[10px]"
              disabled={loadingMore}
              onClick={() => void loadOlder()}
            >
              {loadingMore ? <Loader2 size={12} className="animate-spin" /> : null}
              加载更早消息
            </button>
          </div>
        ) : null}

        {messages.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--faint)]">
              <Smile size={22} />
            </div>
            <p className="mt-3 text-[13px]">还没有消息</p>
            <p className="mt-1 text-[11px] text-[var(--faint)]">说点什么，让 TA 认识你。</p>
          </div>
        ) : null}

        <div className="space-y-1">
          {messages.map((message, index) => {
            if (message.role === 'system') {
              return (
                <p key={message.id} className="py-2 text-center text-[10px] text-[var(--faint)]">
                  {message.deletedAt ? '消息已删除' : message.content}
                </p>
              );
            }
            const mine = message.role === 'user';
            const previous = messages[index - 1];
            const showTime = shouldShowTime(previous, message);
            const isAction = actionId === message.id;
            const member = !mine
              ? chat?.members.find((item) => item.characterId === message.senderId) ?? null
              : null;
            const speakerName = member
              ? member.nickname || member.name
              : chat?.characterNickname || chat?.characterName || 'TA';
            const speakerAvatar = member?.avatar || (isGroup ? '' : chat?.characterAvatar || '');
            return (
              <div key={message.id}>
                {showTime ? (
                  <p className="py-3 text-center text-[9px] tracking-[0.08em] text-[var(--faint)]">
                    {formatTime(message.createdAt)}
                  </p>
                ) : null}
                <div className={`group flex items-start gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                  {!mine ? (
                    speakerAvatar ? (
                      <img
                        src={speakerAvatar}
                        alt=""
                        className="mt-1 h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-medium text-white"
                        style={{ background: member?.color ?? chat?.characterColor ?? '#b4472f' }}
                      >
                        {(member ? speakerName : characterName).slice(0, 1)}
                      </div>
                    )
                  ) : null}

                  <div className={`relative max-w-[78%] ${mine ? 'items-end' : 'items-start'}`}>
                    {isGroup && !mine ? (
                      <p className="mb-0.5 ml-0.5 text-[9px] text-[var(--faint)]">{speakerName}</p>
                    ) : null}
                    <div
                      className={`relative rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                        mine
                          ? 'rounded-br-md bg-[var(--ink)] text-[var(--paper)]'
                          : 'rounded-bl-md border border-[var(--line)] bg-[var(--card-solid)] text-[var(--ink)]'
                      }`}
                    >
                      {message.deletedAt ? (
                        <span className="text-[11px] italic opacity-60">消息已删除</span>
                      ) : message.kind === 'image' ? (
                        <img
                          src={message.content}
                          alt="图片消息"
                          className="max-h-64 max-w-full cursor-zoom-in rounded-xl"
                          onClick={() => window.open(message.content, '_blank')}
                        />
                      ) : mine ? (
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      ) : (
                        <Markdown content={message.content} />
                      )}
                      {!message.deletedAt ? (
                        <button
                          className={`absolute top-0 rounded-md p-1 text-[var(--faint)] opacity-60 transition group-hover:opacity-100 ${
                            mine ? '-left-7' : '-right-7'
                          } hover:text-[var(--ink)]`}
                          onClick={() => setActionId(isAction ? null : message.id)}
                          aria-label="消息操作"
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      ) : null}
                    </div>

                    {message.editedAt ? (
                      <p className={`mt-1 text-[9px] text-[var(--faint)] ${mine ? 'text-right' : ''}`}>
                        已编辑
                      </p>
                    ) : null}

                    {isAction ? (
                      <div
                        className={`card-solid absolute z-20 mt-1 flex gap-1 p-1 text-[10px] shadow-lg ${
                          mine ? 'right-0' : 'left-0'
                        }`}
                      >
                        <button
                          className="rounded-md px-2 py-1.5 hover:bg-[var(--accent-soft)]"
                          onClick={() => {
                            setEditing({ id: message.id, content: message.content });
                            setInput(message.content);
                            setActionId(null);
                            inputRef.current?.focus();
                          }}
                        >
                          <Pencil size={12} className="mr-1 inline" />
                          编辑
                        </button>
                        {!mine && message.id === lastAssistantId ? (
                          <button
                            className="rounded-md px-2 py-1.5 hover:bg-[var(--accent-soft)]"
                            onClick={() => void regenerate(message.id)}
                          >
                            <RefreshCw size={12} className="mr-1 inline" />
                            重说
                          </button>
                        ) : null}
                        <button
                          className="rounded-md px-2 py-1.5 text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                          onClick={() => void removeMessage(message)}
                        >
                          <Trash2 size={12} className="mr-1 inline" />
                          删除
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {mine ? (
                    <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--seal-bg)] text-[10px] font-medium text-[var(--seal-fg)]">
                      {(user?.displayName || '我').slice(0, 1)}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {streaming ? (
            <div className="flex items-start gap-2">
              {streamSpeakerAvatar ? (
                <img
                  src={streamSpeakerAvatar}
                  alt=""
                  className="mt-1 h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-medium text-white"
                  style={{
                    background: streamingSpeaker?.color ?? chat?.characterColor ?? '#b4472f',
                  }}
                >
                  {streamSpeakerName.slice(0, 1)}
                </div>
              )}
              <div className="max-w-[78%]">
                {isGroup ? (
                  <p className="mb-0.5 ml-0.5 text-[9px] text-[var(--faint)]">
                    {streamSpeakerName}
                  </p>
                ) : null}
                <div className="rounded-2xl rounded-bl-md border border-[var(--line)] bg-[var(--card-solid)] px-3.5 py-2.5 text-[13px] leading-relaxed">
                  {streaming.text ? (
                    <p className="whitespace-pre-wrap break-words">{streaming.text}</p>
                  ) : (
                    <span className="flex items-center gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)] [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)] [animation-delay:240ms]" />
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="border-t border-[var(--line)] px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2"
        style={{ background: 'var(--nav)' }}
      >
        {editing ? (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-[var(--accent-soft)] px-3 py-1.5 text-[10px] text-[var(--accent-strong)]">
            <span>正在编辑消息</span>
            <button
              onClick={() => {
                setEditing(null);
                setInput('');
              }}
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        {emojiOpen ? (
          <div className="mb-2 grid grid-cols-8 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--card-solid)] p-2">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                className="rounded-lg py-1 text-lg hover:bg-[var(--accent-soft)]"
                onClick={() => pickEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="表情"
          >
            <Smile size={19} />
          </button>
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || sending}
            aria-label="图片"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={handleFile}
          />
          <textarea
            ref={inputRef}
            className="field composer-field max-h-32 min-h-[38px] flex-1 resize-none py-2 text-[13px]"
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={editing ? '修改后保存' : '说点什么…'}
            disabled={sending && !editing}
          />
          {sending ? (
            <button className="btn btn-ghost h-9 min-h-9 px-3" onClick={stop} aria-label="停止">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="btn btn-accent h-9 min-h-9 px-3"
              onClick={() => void sendText()}
              disabled={!input.trim()}
              aria-label="发送"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>

      {memoryOpen && id ? (
        <MemoryPanel chatId={id} onClose={() => setMemoryOpen(false)} />
      ) : null}
      {scheduleOpen && chat?.characterId ? (
        <SchedulePanel
          characterId={chat.characterId}
          onClose={() => setScheduleOpen(false)}
        />
      ) : null}
    </div>
  );
}
