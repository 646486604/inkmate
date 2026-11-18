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

export function subscribeProactive(handler: (event: ProactiveEvent) => void): () => void {
  const source = new EventSource('/api/events');
  const listener = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as ProactiveEvent;
      if (data?.chatId && data?.message) handler(data);
    } catch {
      // ignore malformed events
    }
  };
  source.addEventListener('proactive', listener as EventListener);
  return () => source.close();
}

export function subscribeMoments(handlers: {
  onMoment?: (event: MomentEvent) => void;
  onComment?: (event: MomentCommentEvent) => void;
}): () => void {
  const source = new EventSource('/api/events');
  const momentListener = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as MomentEvent;
      if (data?.moment) handlers.onMoment?.(data);
    } catch {
      // ignore
    }
  };
  const commentListener = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as MomentCommentEvent;
      if (data?.momentId && data?.comment) handlers.onComment?.(data);
    } catch {
      // ignore
    }
  };
  source.addEventListener('moment', momentListener as EventListener);
  source.addEventListener('moment_comment', commentListener as EventListener);
  return () => source.close();
}

