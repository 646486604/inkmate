import { HttpError } from '../lib/http-error.js';
import { buildGeminiUrl, buildOpenAIUrl, type ProviderConfig } from './provider.js';
import type { ChatMessage } from './stream.js';

function sanitize(text: string, secret: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  if (secret) out = out.split(secret).join('***');
  return out.slice(0, 400);
}

function extractOpenAIText(data: unknown): string {
  const body = data as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? '').join('');
  return '';
}

function extractGeminiText(data: unknown): string {
  const body = data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
}

export async function completeChat(
  config: ProviderConfig,
  messages: ChatMessage[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const maxTokens = options.maxTokens ?? 1200;
  const temperature = options.temperature ?? 0.2;

  if (config.kind === 'gemini') {
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
    if (config.apiKey) headers['x-goog-api-key'] = config.apiKey;

    let response: Response;
    try {
      response = await fetch(buildGeminiUrl(config.baseUrl, config.model), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents,
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HttpError(400, `无法连接模型：${sanitize(message, '')}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HttpError(502, `模型返回 ${response.status}：${sanitize(text, config.apiKey)}`);
    }
    const data = (await response.json().catch(() => null)) as unknown;
    return extractGeminiText(data).trim();
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.extra?.headers ?? {}),
  };
  const hasAuth = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
  if (config.apiKey && !hasAuth) headers.Authorization = `Bearer ${config.apiKey}`;

  let response: Response;
  try {
    response = await fetch(buildOpenAIUrl(config.baseUrl, config.extra?.chatPath), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, `无法连接模型：${sanitize(message, '')}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(502, `模型返回 ${response.status}：${sanitize(text, config.apiKey)}`);
  }
  const data = (await response.json().catch(() => null)) as unknown;
  return extractOpenAIText(data).trim();
}
