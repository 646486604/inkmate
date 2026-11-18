import { HttpError } from '../lib/http-error.js';
import { buildGeminiUrl, buildOpenAIUrl, type ProviderConfig } from './provider.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function sanitize(text: string, secret: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  if (secret) out = out.split(secret).join('***');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***');
  return out.slice(0, 400);
}

async function readError(res: Response, secret: string): Promise<string> {
  const text = await res.text().catch(() => '');
  return sanitize(text || res.statusText, secret);
}

async function* readSSE(res: Response): AsyncGenerator<string> {
  if (!res.body) throw new HttpError(502, '模型没有返回可读的流');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
        newline = buffer.indexOf('\n');
      }
    }
    const tail = buffer.trim();
    if (tail.startsWith('data:')) yield tail.slice(5).trim();
  } finally {
    reader.releaseLock();
  }
}

function openAIHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.extra?.headers ?? {}),
  };
  const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
  if (config.apiKey && !hasAuth) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

async function* streamOpenAI(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetch(buildOpenAIUrl(config.baseUrl, config.extra?.chatPath), {
      method: 'POST',
      headers: openAIHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: 0.85,
        max_tokens: 900,
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `无法连接模型：${sanitize(message, '')}`);
  }

  if (!res.ok) {
    throw new HttpError(502, `模型返回 ${res.status}：${await readError(res, config.apiKey)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;
    const text = data?.choices?.[0]?.message?.content ?? '';
    if (text) yield text;
    return;
  }

  for await (const payload of readSSE(res)) {
    if (!payload || payload === '[DONE]') continue;
    let data: {
      choices?: Array<{
        delta?: { content?: string | Array<{ text?: string }> };
        message?: { content?: string };
      }>;
    };
    try {
      data = JSON.parse(payload) as typeof data;
    } catch {
      continue;
    }
    const delta = data.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      yield delta;
    } else if (Array.isArray(delta)) {
      const text = delta.map((part) => part.text ?? '').join('');
      if (text) yield text;
    } else {
      const message = data.choices?.[0]?.message?.content;
      if (message) yield message;
    }
  }
}

async function* streamGemini(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.extra?.headers ?? {}),
  };
  const hasKey = Object.keys(headers).some((key) => key.toLowerCase() === 'x-goog-api-key');
  if (config.apiKey && !hasKey) headers['x-goog-api-key'] = config.apiKey;

  let res: Response;
  try {
    res = await fetch(buildGeminiUrl(config.baseUrl, config.model, 'streamGenerateContent'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { temperature: 0.85, maxOutputTokens: 900 },
      }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `无法连接模型：${sanitize(message, '')}`);
  }

  if (!res.ok) {
    throw new HttpError(502, `模型返回 ${res.status}：${await readError(res, config.apiKey)}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    const data = (await res.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    const text =
      data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (text) yield text;
    return;
  }

  for await (const payload of readSSE(res)) {
    if (!payload) continue;
    let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      data = JSON.parse(payload) as typeof data;
    } catch {
      continue;
    }
    const text =
      data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (text) yield text;
  }
}

export async function* streamChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (!config.model) throw new HttpError(400, '该角色没有配置模型');
  if (config.kind === 'gemini') {
    yield* streamGemini(config, messages, signal);
    return;
  }
  yield* streamOpenAI(config, messages, signal);
}
