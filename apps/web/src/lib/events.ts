import type {
  MessagePublic,
  MomentCommentPublic,
  MomentPublic,
} from '@inkmate/shared';

export interface ProactiveEvent {
  chatId: string;
  characterId: string;
  message: MessagePublic;
  beatId: string;
}

export interface MomentEvent {
  moment: MomentPublic;
}

export interface MomentCommentEvent {
  momentId: string;
  comment: MomentCommentPublic;
}

type RawHandler = (data: unknown) => void;

const EVENT_NAMES = ['proactive', 'moment', 'moment_comment'] as const;

// 手机浏览器对同一域名只给 6 条 HTTP/1.1 连接，每个页面各开一条 SSE
// 很容易把连接池占满，导致后面的请求全部排队——“转圈”“卡片空白”都由此放大。
// 这里全局复用一条 /api/events，连接数固定为 1。
const listeners = new Map<string, Set<RawHandler>>(EVENT_NAMES.map((name) => [name, new Set()]));
let source: EventSource | null = null;

function dispatch(name: string, raw: string): void {
  const set = listeners.get(name);
  if (!set || set.size === 0) return;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  // 复制一份再遍历：handler 里可能同步退订
  for (const handler of [...set]) {
    try {
      handler(data);
    } catch {
      // 单个 handler 抛错不影响其它订阅者
    }
  }
}

function ensureSource(): void {
  if (source) return;
  const next = new EventSource('/api/events');
  for (const name of EVENT_NAMES) {
    next.addEventListener(name, (event) => {
      dispatch(name, (event as MessageEvent<string>).data);
    });
  }
  source = next;
}

function closeIfIdle(): void {
  if (!source) return;
  for (const set of listeners.values()) {
    if (set.size > 0) return;
  }
  source.close();
  source = null;
}

function subscribe<T>(name: (typeof EVENT_NAMES)[number], handler: (data: T) => void): () => void {
  const set = listeners.get(name);
  if (!set) return () => undefined;
  const raw = handler as RawHandler;
  set.add(raw);
  ensureSource();
  return () => {
    set.delete(raw);
    closeIfIdle();
  };
}

export function subscribeProactive(handler: (event: ProactiveEvent) => void): () => void {
  return subscribe<ProactiveEvent>('proactive', (data) => {
    if (data?.chatId && data?.message) handler(data);
  });
}

export function subscribeMoments(handlers: {
  onMoment?: (event: MomentEvent) => void;
  onComment?: (event: MomentCommentEvent) => void;
}): () => void {
  const offMoment = handlers.onMoment
    ? subscribe<MomentEvent>('moment', (data) => {
        if (data?.moment) handlers.onMoment?.(data);
      })
    : () => undefined;
  const offComment = handlers.onComment
    ? subscribe<MomentCommentEvent>('moment_comment', (data) => {
        if (data?.momentId && data?.comment) handlers.onComment?.(data);
      })
    : () => undefined;
  return () => {
    offMoment();
    offComment();
  };
}
