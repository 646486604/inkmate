import type { ChatMemberPublic, MessagePublic } from '@inkmate/shared';
import { ApiError } from './api';

export interface StreamStart {
  createdAt: number;
  userMessage: MessagePublic | null;
  /** 连发多条时，这一批用户消息（顺序即插入顺序） */
  userMessages?: MessagePublic[];
  speaker?: ChatMemberPublic | null;
}

export interface StreamDone {
  message: MessagePublic;
  interrupted?: boolean;
  error?: string;
}

export interface StreamHandlers {
  onStart?: (data: StreamStart) => void;
  onDelta?: (text: string) => void;
  /** 一条回复可能落成多条消息（文字 + 表情包） */
  onMessage?: (message: MessagePublic) => void;
  onDone?: (data: StreamDone) => void;
  onError?: (message: string) => void;
}

interface SSEEvent {
  event: string;
  data: unknown;
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `请求失败（${res.status}）`;
  } catch {
    return `请求失败（${res.status}）`;
  }
}

export async function streamAssistant(
  url: string,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, '无法连接服务');
  }

  if (!res.ok) throw new ApiError(res.status, await readError(res));
  if (!res.body) throw new ApiError(500, '服务没有返回流式内容');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const processBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let data: unknown;
    try {
      data = JSON.parse(dataLines.join('\n'));
    } catch {
      return;
    }
    const payload = data as {
      text?: string;
      message?: MessagePublic;
      error?: string;
      interrupted?: boolean;
    };
    if (event === 'start') {
      handlers.onStart?.(data as StreamStart);
    } else if (event === 'delta') {
      if (payload.text) handlers.onDelta?.(payload.text);
    } else if (event === 'message') {
      if (payload.message) handlers.onMessage?.(payload.message);
    } else if (event === 'done') {
      if (payload.message) {
        handlers.onDone?.({
          message: payload.message,
          interrupted: payload.interrupted,
          error: payload.error,
        });
        finished = true;
      }
    } else if (event === 'error') {
      handlers.onError?.(payload.error ?? '生成失败');
      finished = true;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        processBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!finished && !signal?.aborted) {
    handlers.onError?.('连接意外中断，请重试');
  }
}
