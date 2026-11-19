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
  Gift,
  ImagePlus,
  ListPlus,
  Loader2,
  Mic,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  SkipForward,
  Smile,
  Square,
  Trash2,
  Type,
  UserRound,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  ChatBubbleStyle,
  ChatMemberPublic,
  ChatPublic,
  MessagePublic,
  StickerPublic,
} from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { streamAssistant } from '../lib/chat-stream';
import { useAuth } from '../lib/auth';
import { subscribeProactive } from '../lib/events';
import { useMusicPlayer } from '../lib/music-player';
import { MemoryPanel } from '../components/MemoryPanel';
import { SchedulePanel } from '../components/SchedulePanel';
import { applyBubbleStyle, bubblePreviewStyle, getBubbleStyle } from '../lib/appearance';

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

/** 模型会把一次回复拆成多行，这里按换行还原成多个气泡 */
function splitBubbles(text: string): string[] {
  const parts = text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, 8);
}

/** 带原始行号的版本，用来定位“第几个气泡”做局部编辑/删除 */
function bubbleEntries(text: string): Array<{ text: string; index: number }> {
  return text
    .split('\n')
    .map((line, index) => ({ text: line.trim(), index }))
    .filter((entry) => entry.text.length > 0)
    .slice(0, 8);
}

const BUBBLE_BASE = 'w-fit max-w-full rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed';
const BUBBLE_MINE = `${BUBBLE_BASE} bubble-mine rounded-br-md`;
const BUBBLE_MINE_FLAT = `${BUBBLE_BASE} bubble-mine`;
const BUBBLE_OTHER = `${BUBBLE_BASE} bubble-other rounded-bl-md border border-[var(--line)]`;
const BUBBLE_OTHER_FLAT = `${BUBBLE_BASE} bubble-other border border-[var(--line)]`;

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
  const [pending, setPending] = useState<
    Array<{
      kind: 'text' | 'image' | 'desc-image' | 'voice' | 'red-packet';
      value: string;
      description?: string;
      sticker?: boolean;
      durationSeconds?: number;
      amount?: number;
    }>
  >([]);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [streaming, setStreaming] = useState<{ text: string; createdAt: number } | null>(null);
  const [streamingSpeaker, setStreamingSpeaker] = useState<ChatMemberPublic | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [stickerTab, setStickerTab] = useState<'emoji' | 'sticker' | 'more'>('emoji');
  const [stickers, setStickers] = useState<StickerPublic[]>([]);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityName, setIdentityName] = useState('');
  const [identityPersona, setIdentityPersona] = useState('');
  const [identityBusy, setIdentityBusy] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [bubbleDraft, setBubbleDraft] = useState(() => getBubbleStyle());
  const [bubbleBusy, setBubbleBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stickerRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .stickers()
      .then((result) => {
        if (alive) setStickers(result.stickers);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 会话有自己的气泡样式就用它，没有就退回全局默认；离开会话恢复全局
  useEffect(() => {
    if (!chat) return;
    applyBubbleStyle(chat.bubble ?? getBubbleStyle());
  }, [chat?.id, chat?.bubble]);

  useEffect(
    () => () => {
      applyBubbleStyle(getBubbleStyle());
    },
    [],
  );

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
    if (!id || sending) return;

    if (editing) {
      const content = input.trim();
      if (!content) return;
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

    const trimmed = input.trim();
    const batch = [
      ...pending,
      ...(trimmed ? [{ kind: 'text' as const, value: trimmed }] : []),
    ].slice(0, 10);
    if (batch.length === 0) return;

    setInput('');
    setEmojiOpen(false);
    const controller = beginStream();
    try {
      await streamAssistant(
        `/api/chats/${id}/messages/batch`,
        {
          items: batch.map((item) => ({
            kind: item.kind,
            content: item.value,
            ...(item.description ? { description: item.description } : {}),
            ...(item.sticker ? { sticker: true } : {}),
            ...(item.durationSeconds !== undefined
              ? { durationSeconds: item.durationSeconds }
              : {}),
            ...(item.amount !== undefined ? { amount: item.amount } : {}),
          })),
        },
        {
          onStart: (data) => {
            const inserted = data.userMessages ?? (data.userMessage ? [data.userMessage] : []);
            if (inserted.length > 0) {
              setMessages((current) => inserted.reduce((acc, message) => upsert(acc, message), current));
            }
            // 服务端已经落库，占位的「待发」气泡可以撤掉了
            setPending([]);
            setStreamingSpeaker(data.speaker ?? null);
            setStreaming({ text: '', createdAt: data.createdAt });
          },
          onDelta: (text) =>
            setStreaming((current) =>
              current ? { ...current, text: current.text + text } : current,
            ),
          onMessage: (message) => setMessages((current) => upsert(current, message)),
          onDone: (data) => {
            if (data.message) setMessages((current) => upsert(current, data.message!));
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
        setPending(batch);
      }
      finishStream();
    }
  }

  function queueMessage() {
    const text = input.trim();
    if (!text) return;
    setPending((current) =>
      [...current, { kind: 'text' as const, value: text }].slice(0, 10),
    );
    setInput('');
    inputRef.current?.focus();
  }

  /** 表情包也先放进待发，和文字一起发；带上描述，AI 才知道你发的是什么 */
  function queueSticker(url: string, desc: string) {
    setPending((current) =>
      [
        ...current,
        {
          kind: 'image' as const,
          value: url,
          sticker: true,
          description: desc.trim() || undefined,
        },
      ].slice(0, 10),
    );
  }
  function queueVoice() {
    const text = window.prompt('语音里说什么？（文字演的，不会录音）', '');
    if (text === null) return;
    const content = text.trim() || '（语音）';
    const durationSeconds = Math.max(1, Math.min(60, Math.round(content.length / 4) || 1));
    setPending((current) =>
      [...current, { kind: 'voice' as const, value: content, durationSeconds }].slice(0, 10),
    );
    setEmojiOpen(false);
  }

  function queueRedPacket() {
    const raw = window.prompt('红包金额（元）', '6.66');
    if (raw === null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('红包金额不对');
      return;
    }
    const note = window.prompt('红包留言（可留空）', '恭喜发财');
    setPending((current) =>
      [
        ...current,
        {
          kind: 'red-packet' as const,
          value: (note ?? '').trim() || '恭喜发财',
          amount,
        },
      ].slice(0, 10),
    );
    setEmojiOpen(false);
  }

  function queueDescImage() {
    const desc = window.prompt('这张「文字图」画的是什么？（例如：窗外的雨）', '');
    if (desc === null) return;
    const content = desc.trim();
    if (!content) return;
    setPending((current) =>
      [...current, { kind: 'desc-image' as const, value: content }].slice(0, 10),
    );
    setEmojiOpen(false);
  }

  async function sendImage(input: File | string, description?: string) {
    if (!id || sending) return;
    setUploading(typeof input !== 'string');
    setError('');
    try {
      const uploadedUrl =
        typeof input === 'string' ? input : (await api.upload(input)).url;
      const controller = beginStream();
      try {
        await streamAssistant(
          `/api/chats/${id}/messages`,
          { content: uploadedUrl, kind: 'image', ...(description ? { description } : {}) },
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
            onMessage: (message) => setMessages((current) => upsert(current, message)),
            onDone: (data) => {
              if (data.message) setMessages((current) => upsert(current, data.message!));
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
          onMessage: (message) => setMessages((current) => upsert(current, message)),
          onDone: (data) => {
            if (data.message) setMessages((current) => upsert(current, data.message!));
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
      await api.deleteMessage(message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setActionId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    }
  }

  /** 只改/删其中一个气泡：把那条气泡对应的行改掉，其余保持 */
  async function editBubble(message: MessagePublic, lineIndex: number, current: string) {
    const next = window.prompt('改这一条气泡', current);
    if (next === null) return;
    const lines = message.content.split('\n');
    const text = next.trim();
    if (text) lines[lineIndex] = text;
    else lines.splice(lineIndex, 1);
    const content = lines.join('\n').trim();
    try {
      if (!content) {
        await api.deleteMessage(message.id);
        setMessages((list) => list.filter((item) => item.id !== message.id));
      } else {
        const result = await api.editMessage(message.id, content);
        setMessages((list) => upsert(list, result.message));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改失败');
    }
  }

  async function deleteBubble(message: MessagePublic, lineIndex: number) {
    if (!window.confirm('删掉这条气泡？只删这一条，其余不动。')) return;
    const lines = message.content.split('\n');
    lines.splice(lineIndex, 1);
    const content = lines.join('\n').trim();
    try {
      if (!content) {
        await api.deleteMessage(message.id);
        setMessages((list) => list.filter((item) => item.id !== message.id));
        setActionId(null);
      } else {
        const result = await api.editMessage(message.id, content);
        setMessages((list) => upsert(list, result.message));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除气泡失败');
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
    if (event.target) event.target.value = '';
    if (!file) return;
    const description = window.prompt(
      '给这张图写一句描述，让 TA 也能「看到」（可留空）',
      '',
    );
    void sendImage(file, (description ?? '').trim());
  }

  function openIdentity() {
    setIdentityName(chat?.userName || user?.displayName || '');
    setIdentityPersona(chat?.userPersona || user?.persona || '');
    setIdentityOpen(true);
    setMenuOpen(false);
  }

  async function saveIdentity() {
    if (!id || identityBusy) return;
    setIdentityBusy(true);
    setError('');
    try {
      const result = await api.updateChat(id, {
        userName: identityName.trim(),
        userPersona: identityPersona.trim(),
      });
      setChat(result.chat);
      setIdentityOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存身份失败');
    } finally {
      setIdentityBusy(false);
    }
  }

  async function handleStickerUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file || stickerBusy) return;
    setStickerBusy(true);
    setError('');
    try {
      const result = await api.addSticker(file);
      setStickers(result.stickers);
      const desc = window.prompt(
        '给这张表情写个描述，AI 靠它决定什么时候发（例如：猫猫得意）',
        '',
      );
      if (desc && desc.trim()) {
        const updated = await api.updateSticker(result.sticker.url, desc.trim());
        setStickers(updated.stickers);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '表情包上传失败');
    } finally {
      setStickerBusy(false);
    }
  }

  async function editStickerDesc(sticker: StickerPublic) {
    const next = window.prompt(
      '描述（AI 靠它决定何时发；留空表示只给你手动发）',
      sticker.desc,
    );
    if (next === null) return;
    try {
      const result = await api.updateSticker(sticker.url, next.trim());
      setStickers(result.stickers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存描述失败');
    }
  }

  function openBubbleStyle() {
    setBubbleDraft(chat?.bubble ?? getBubbleStyle());
    setBubbleOpen(true);
    setMenuOpen(false);
  }

  async function saveBubbleStyle(style: ChatBubbleStyle | null) {
    if (!id || bubbleBusy) return;
    setBubbleBusy(true);
    setError('');
    try {
      const result = await api.updateChat(id, { bubble: style });
      setChat(result.chat);
      setBubbleOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存气泡样式失败');
    } finally {
      setBubbleBusy(false);
    }
  }

  async function setChatBackground(url: string) {
    if (!id) return;
    setBgBusy(true);
    setError('');
    try {
      const result = await api.updateChat(id, { background: url });
      setChat(result.chat);
      setBgOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '设置背景失败');
    } finally {
      setBgBusy(false);
    }
  }

  async function uploadBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    setBgBusy(true);
    setError('');
    try {
      const uploaded = await api.upload(file);
      await setChatBackground(uploaded.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '背景上传失败');
    } finally {
      setBgBusy(false);
    }
  }

  async function removeSticker(url: string) {
    try {
      const result = await api.removeSticker(url);
      setStickers(result.stickers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除表情失败');
    }
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
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            if (!isGroup && chat?.characterId) navigate(`/characters/${chat.characterId}`);
          }}
        >
          <p className="truncate text-[14px] font-medium">{characterName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--faint)]">
            {!isGroup ? <span className="h-1.5 w-1.5 rounded-full bg-[#2fa463]" /> : null}
            {isGroup ? `${memberCount} 人` : '在线 · 点开看主页'}
          </p>
        </button>
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
                    今天的计划
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
                onClick={openIdentity}
              >
                <UserRound size={12} className="mr-1.5 inline" />
                我的身份
              </button>
              <button
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                onClick={() => {
                  setBgOpen(true);
                  setMenuOpen(false);
                }}
              >
                <ImagePlus size={12} className="mr-1.5 inline" />
                聊天背景
              </button>
              <button
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                onClick={openBubbleStyle}
              >
                <Smile size={12} className="mr-1.5 inline" />
                气泡样式
              </button>
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

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {chat?.background ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url(${chat.background})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        ) : null}
        <div
          ref={scrollRef}
          className="relative h-full overflow-y-auto px-4 py-4"
        >
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
            // 删掉的消息直接不显示，不留占位气泡
            if (message.deletedAt) return null;
            if (message.role === 'system') {
              return (
                <p key={message.id} className="py-2 text-center text-[10px] text-[var(--faint)]">
                  {message.content}
                </p>
              );
            }
            const mine = message.role === 'user';
            const previous = messages[index - 1];
            const showTime = shouldShowTime(previous, message);
            // 同一个人连发的消息归成一组：只有第一条带“尾巴”，后面都是整齐的圆角方块
            const grouped = Boolean(
              previous &&
                previous.role === message.role &&
                previous.senderId === message.senderId &&
                !previous.deletedAt &&
                message.createdAt - previous.createdAt < 2 * 60 * 1000,
            );
            const isAction = actionId === message.id;
            const voiceSeconds =
              typeof message.meta?.durationSeconds === 'number'
                ? message.meta.durationSeconds
                : 0;
            const packetAmount =
              typeof message.meta?.amount === 'number' ? message.meta.amount : 0;
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
                    grouped ? (
                      <span className="mt-1 h-7 w-7 shrink-0" aria-hidden />
                    ) : speakerAvatar ? (
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

                  <div
                    className={`relative flex max-w-[78%] flex-col ${
                      mine ? 'items-end' : 'items-start'
                    }`}
                  >
                    {isGroup && !mine ? (
                      <p className="mb-0.5 ml-0.5 text-[9px] text-[var(--faint)]">{speakerName}</p>
                    ) : null}
                    {message.kind === 'voice' ? (
                      <div className={`relative ${grouped ? BUBBLE_OTHER_FLAT : BUBBLE_OTHER}`}>
                        <div className="flex items-center gap-2 text-[13px]">
                          <Volume2 size={14} className="shrink-0 opacity-80" />
                          <span className="tabular">{voiceSeconds || 1}″</span>
                        </div>
                        {message.content ? (
                          <span className="mt-1 block text-[10px] leading-relaxed opacity-70">
                            {message.content}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-[8px] opacity-50">文字演的语音</span>
                      </div>
                    ) : message.kind === 'red-packet' ? (
                      <div className="w-44 rounded-xl bg-[#c94a3d] px-3 py-2.5 text-[#fff3e6]">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium">
                          <Gift size={13} />
                          红包
                        </div>
                        <p className="mt-1 text-[17px] font-medium tabular">
                          ¥{packetAmount || 0}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-relaxed opacity-85">
                          {message.content || '恭喜发财'}
                        </p>
                        <p className="mt-1 text-[8px] opacity-60">假装拆开 · 不会真有钱</p>
                      </div>
                    ) : message.kind === 'desc-image' ? (
                      <div
                        className={`relative ${
                          mine
                            ? grouped
                              ? BUBBLE_MINE_FLAT
                              : BUBBLE_MINE
                            : grouped
                              ? BUBBLE_OTHER_FLAT
                              : BUBBLE_OTHER
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <ImagePlus size={13} className="mt-0.5 shrink-0 opacity-70" />
                          <span className="whitespace-pre-wrap break-words">
                            {message.content}
                          </span>
                        </div>
                        <span className="mt-1 block text-[8px] opacity-60">文字图</span>
                      </div>
                    ) : message.kind === 'image' ? (
                      <div
                        className={`relative ${
                          mine
                            ? grouped
                              ? BUBBLE_MINE_FLAT
                              : BUBBLE_MINE
                            : grouped
                              ? BUBBLE_OTHER_FLAT
                              : BUBBLE_OTHER
                        }`}
                      >
                        <img
                          src={message.content}
                          alt="图片消息"
                          className="max-h-64 max-w-full cursor-zoom-in rounded-xl"
                          onClick={() => window.open(message.content, '_blank')}
                        />
                        {typeof message.meta?.description === 'string' &&
                        message.meta.description ? (
                          <span className="mt-1 block text-[9px] leading-relaxed opacity-70">
                            {message.meta.description}
                          </span>
                        ) : null}
                      </div>
                    ) : mine ? (
                      <div className={`relative ${grouped ? BUBBLE_MINE_FLAT : BUBBLE_MINE}`}>
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {bubbleEntries(message.content).map((entry, bubbleIndex) => (
                          <div
                            key={entry.index}
                            className={
                              bubbleIndex === 0 && !grouped ? BUBBLE_OTHER : BUBBLE_OTHER_FLAT
                            }
                          >
                            <Markdown content={entry.text} />
                            {isAction ? (
                              <div className="mt-1.5 flex gap-3 border-t border-[var(--line)] pt-1.5 text-[10px] text-[var(--faint)]">
                                <button
                                  className="hover:text-[var(--accent)]"
                                  onClick={() => void editBubble(message, entry.index, entry.text)}
                                >
                                  改这条
                                </button>
                                <button
                                  className="hover:text-[var(--accent-strong)]"
                                  onClick={() => void deleteBubble(message, entry.index)}
                                >
                                  删这条
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
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
                    user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt=""
                        className="mt-1 h-7 w-7 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <div className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--seal-bg)] text-[10px] font-medium text-[var(--seal-fg)]">
                        {(user?.displayName || '我').slice(0, 1)}
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}

          {pending.map((item, index) => (
            <div key={`pending-${index}`} className="flex justify-end">
              <div className="max-w-[78%]">
                <div className="rounded-2xl rounded-br-md border border-dashed border-[var(--line-strong)] bg-[var(--paper-strong)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--muted)]">
                  {item.kind === 'image' ? (
                    <img src={item.value} alt="待发表情" className="max-h-32 rounded-xl" />
                  ) : item.kind === 'desc-image' ? (
                    <span className="flex items-start gap-2">
                      <ImagePlus size={13} className="mt-0.5 shrink-0 opacity-70" />
                      <span className="whitespace-pre-wrap break-words">{item.value}</span>
                    </span>
                  ) : item.kind === 'voice' ? (
                    <span className="flex items-center gap-2">
                      <Volume2 size={13} className="shrink-0 opacity-80" />
                      <span className="tabular">{item.durationSeconds ?? 1}″</span>
                      <span className="text-[10px] opacity-70">{item.value}</span>
                    </span>
                  ) : item.kind === 'red-packet' ? (
                    <span className="block w-40 rounded-lg bg-[#c94a3d] px-2.5 py-2 text-[#fff3e6]">
                      <span className="flex items-center gap-1 text-[10px]">
                        <Gift size={12} />
                        红包
                      </span>
                      <span className="mt-0.5 block text-[15px] tabular">¥{item.amount ?? 0}</span>
                      <span className="block text-[9px] opacity-85">{item.value}</span>
                    </span>
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{item.value}</span>
                  )}
                </div>
                <button
                  className="mt-0.5 block w-full text-right text-[9px] text-[var(--faint)]"
                  onClick={() =>
                    setPending((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                >
                  待发 · 点这里移除
                </button>
              </div>
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt=""
                  className="ml-2 mt-1 h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="ml-2 mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--seal-bg)] text-[10px] font-medium text-[var(--seal-fg)]">
                  {(user?.displayName || '我').slice(0, 1)}
                </div>
              )}
            </div>
          ))}

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
                {streaming.text ? (
                  <div className="space-y-1.5">
                    {splitBubbles(streaming.text).map((part, bubbleIndex) => (
                      <div key={bubbleIndex} className={BUBBLE_OTHER}>
                        <p className="whitespace-pre-wrap break-words">{part}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={BUBBLE_OTHER}>
                    <span className="flex items-center gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)] [animation-delay:120ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--faint)] [animation-delay:240ms]" />
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
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
          <div className="mb-2 rounded-2xl border border-[var(--line)] bg-[var(--card-solid)] p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex gap-1">
                {(
                  [
                    ['emoji', '表情'],
                    ['sticker', `表情包 ${stickers.length ? stickers.length : ''}`.trim()],
                    ['more', '更多'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`rounded-lg px-2.5 py-1 text-[10px] ${
                      stickerTab === value
                        ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                        : 'text-[var(--muted)]'
                    }`}
                    onClick={() => setStickerTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {stickerTab === 'sticker' ? (
                <button
                  className="btn btn-quiet h-6 min-h-6 px-2 text-[10px]"
                  disabled={stickerBusy}
                  onClick={() => stickerRef.current?.click()}
                >
                  {stickerBusy ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  上传
                </button>
              ) : null}
            </div>

            <input
              ref={stickerRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={handleStickerUpload}
            />

            {stickerTab === 'emoji' ? (
              <div className="grid grid-cols-8 gap-1">
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
            ) : stickerTab === 'more' ? (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { label: '图片', icon: ImagePlus, onClick: () => fileRef.current?.click() },
                    { label: '文字图', icon: Type, onClick: queueDescImage },
                    { label: '语音', icon: Mic, onClick: queueVoice },
                    { label: '红包', icon: Gift, onClick: queueRedPacket },
                  ] as const
                ).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--line)] py-3 text-[10px] text-[var(--muted)] hover:bg-[var(--accent-soft)]"
                      onClick={action.onClick}
                      disabled={uploading || sending}
                    >
                      <Icon size={20} />
                      {action.label}
                    </button>
                  );
                })}
                <p className="col-span-2 pt-1 text-center text-[9px] leading-relaxed text-[var(--faint)]">
                  这些都会先进入「待发」，和文字一起发；语音和红包是文字演的，不会真录音、也不会真扣钱
                </p>
              </div>
            ) : stickers.length === 0 ? (
              <p className="py-4 text-center text-[10px] leading-relaxed text-[var(--faint)]">
                还没有表情包。点右上角「上传」，选一张图（≤2MB），之后点一下就加进待发。
              </p>
            ) : (
              <div className="grid max-h-56 grid-cols-5 gap-2 overflow-y-auto">
                {stickers.map((sticker) => (
                  <div key={sticker.url} className="relative">
                    <button
                      className="flex h-16 w-full items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1"
                      onClick={() => queueSticker(sticker.url, sticker.desc)}
                      aria-label="加入待发"
                      title={sticker.desc || '还没写描述，AI 不会主动发这张'}
                    >
                      <img
                        src={sticker.url}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    </button>
                    <button
                      className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[9px] text-white"
                      onClick={() => void editStickerDesc(sticker)}
                      aria-label="编辑描述"
                    >
                      ✎
                    </button>
                    <button
                      className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white"
                      onClick={() => void removeSticker(sticker.url)}
                      aria-label="删除表情"
                    >
                      <X size={11} />
                    </button>
                    {sticker.desc ? (
                      <span className="mt-0.5 block truncate text-[8px] text-[var(--faint)]">
                        {sticker.desc}
                      </span>
                    ) : null}
                  </div>
                ))}
                <p className="col-span-5 pt-1 text-center text-[9px] text-[var(--faint)]">
                  点表情加入「待发」，右侧发送键一起发；文字和表情可以混着攒
                </p>
              </div>
            )}
          </div>
        ) : null}

        {pending.length > 0 ? (
          <div className="mb-2 flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-1.5 text-[10px] text-[var(--faint)]">
            <span>已攒 {pending.length} 条，点发送一起发（AI 只回一条）</span>
            <button className="text-[var(--accent-strong)]" onClick={() => setPending([])}>
              清空
            </button>
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={handleFile}
        />

        <div className="flex items-end gap-2">
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="更多"
          >
            <Plus size={19} className={`transition ${emojiOpen ? 'rotate-45' : ''}`} />
          </button>
          <textarea
            ref={inputRef}
            className="field composer-field max-h-32 min-h-[38px] flex-1 resize-none py-2 text-[13px]"
            rows={1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={editing ? '修改后保存' : pending.length ? '再写点，或者直接发送' : '说点什么…'}
            disabled={sending && !editing}
          />
          <button
            className="btn btn-quiet h-9 min-h-9 px-2"
            onClick={queueMessage}
            disabled={!input.trim() || sending || Boolean(editing)}
            title="先攒着，稍后几条一起发"
            aria-label="攒一条"
          >
            <ListPlus size={18} />
          </button>
          {sending ? (
            <button className="btn btn-ghost h-9 min-h-9 px-3" onClick={stop} aria-label="停止">
              <Square size={15} fill="currentColor" />
            </button>
          ) : (
            <button
              className="btn btn-accent h-9 min-h-9 px-3"
              onClick={() => void sendText()}
              disabled={!input.trim() && pending.length === 0}
              aria-label="发送"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>

      {bubbleOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center">
          <div className="card-solid w-full max-w-[420px] p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium">这个会话的气泡样式</p>
                <p className="mt-1 text-[10px] text-[var(--faint)]">
                  只影响这个会话，不改全局外观
                </p>
              </div>
              <button
                className="btn btn-quiet h-8 min-h-8 px-2"
                onClick={() => setBubbleOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--paper-strong)] px-3 py-2">
              <span
                className="rounded-2xl rounded-bl-md px-2.5 py-1.5 text-[11px]"
                style={bubblePreviewStyle(bubbleDraft.otherColor, bubbleDraft.alpha)}
              >
                在的
              </span>
              <span
                className="ml-auto rounded-2xl rounded-br-md px-2.5 py-1.5 text-[11px]"
                style={bubblePreviewStyle(bubbleDraft.mineColor, bubbleDraft.alpha)}
              >
                我到了
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex items-center justify-between rounded-xl border border-[var(--line)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
                我的
                <input
                  type="color"
                  value={bubbleDraft.mineColor}
                  onChange={(event) =>
                    setBubbleDraft({ ...bubbleDraft, mineColor: event.target.value })
                  }
                  className="h-6 w-8 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-[var(--line)] px-2.5 py-2 text-[10px] text-[var(--muted)]">
                对方
                <input
                  type="color"
                  value={bubbleDraft.otherColor}
                  onChange={(event) =>
                    setBubbleDraft({ ...bubbleDraft, otherColor: event.target.value })
                  }
                  className="h-6 w-8 cursor-pointer rounded border border-[var(--line)] bg-transparent"
                />
              </label>
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between text-[9px] text-[var(--faint)]">
                <span>不透明度</span>
                <span className="tabular">{Math.round(bubbleDraft.alpha * 100)}%</span>
              </div>
              <input
                type="range"
                min={35}
                max={100}
                step={5}
                value={Math.round(bubbleDraft.alpha * 100)}
                onChange={(event) =>
                  setBubbleDraft({ ...bubbleDraft, alpha: Number(event.target.value) / 100 })
                }
                className="mt-1 w-full accent-[var(--accent)]"
              />
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-primary h-9 min-h-9 flex-1 text-[11px]"
                disabled={bubbleBusy}
                onClick={() => void saveBubbleStyle(bubbleDraft)}
              >
                {bubbleBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                保存到这个会话
              </button>
              <button
                className="btn btn-ghost h-9 min-h-9 px-3 text-[11px]"
                disabled={bubbleBusy}
                onClick={() => void saveBubbleStyle(null)}
              >
                用全局默认
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bgOpen ? (        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center">
          <div className="card-solid w-full max-w-[420px] p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium">聊天背景</p>
                <p className="mt-1 text-[10px] text-[var(--faint)]">只对这个会话生效</p>
              </div>
              <button
                className="btn btn-quiet h-8 min-h-8 px-2"
                onClick={() => setBgOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            {chat?.background ? (
              <img
                src={chat.background}
                alt=""
                className="mt-3 h-32 w-full rounded-xl object-cover"
              />
            ) : (
              <p className="mt-3 rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-6 text-center text-[10px] text-[var(--faint)]">
                还没有设置背景
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                className="btn btn-primary h-9 min-h-9 flex-1 text-[11px]"
                disabled={bgBusy}
                onClick={() => bgRef.current?.click()}
              >
                {bgBusy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ImagePlus size={12} />
                )}
                {chat?.background ? '换一张' : '上传背景'}
              </button>
              {chat?.background ? (
                <button
                  className="btn btn-ghost h-9 min-h-9 px-3 text-[11px]"
                  disabled={bgBusy}
                  onClick={() => void setChatBackground('')}
                >
                  清除
                </button>
              ) : null}
            </div>
            <input
              ref={bgRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={uploadBackground}
            />
          </div>
        </div>
      ) : null}

      {identityOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-4 sm:items-center">
          <div className="card-solid w-full max-w-[440px] p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium">我在这个会话里的身份</p>
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
                  只影响这个会话；留空就用「我的设定」里的全局默认。
                </p>
              </div>
              <button
                className="btn btn-quiet h-8 min-h-8 px-2"
                onClick={() => setIdentityOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <input
              className="field mt-3"
              value={identityName}
              onChange={(event) => setIdentityName(event.target.value)}
              placeholder="名字，例如：林晚"
              maxLength={40}
            />
            <textarea
              className="field mt-2 min-h-[110px] resize-y"
              value={identityPersona}
              onChange={(event) => setIdentityPersona(event.target.value)}
              placeholder="在这个角色面前，你是什么身份、什么关系、什么性格……"
              maxLength={4000}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[9px] tabular text-[var(--faint)]">
                {identityPersona.length} / 4000
              </span>
              <div className="flex gap-2">
                <button className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]" onClick={() => setIdentityOpen(false)}>
                  取消
                </button>
                <button
                  className="btn btn-primary h-8 min-h-8 px-3 text-[11px]"
                  disabled={identityBusy}
                  onClick={() => void saveIdentity()}
                >
                  {identityBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
