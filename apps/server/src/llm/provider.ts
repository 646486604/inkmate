import type { ProviderExtra, ProviderKind } from '@inkmate/shared';
import { HttpError } from '../lib/http-error.js';

export interface ProviderConfig {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  extra?: ProviderExtra;
}

const TIMEOUT_MS = 12_000;
const MAX_MODELS = 300;

export function buildOpenAIUrl(baseUrl: string, chatPath?: string): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/, '');
  if (!/\/v\d+(\/|$)/.test(path) && !/\/openai(\/|$)/.test(path)) {
    path += '/v1';
  }
  const suffix = (chatPath?.trim() || '/chat/completions').replace(/^\/?/, '/');
  url.pathname = `${path}${suffix}`.replace(/\/{2,}/g, '/');
  return url.toString();
}

export function buildGeminiUrl(
  baseUrl: string,
  model: string,
  action: 'generateContent' | 'streamGenerateContent' = 'generateContent',
): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/v1$/.test(path)) path = path.slice(0, -3);
  if (!/\/v1beta$/.test(path)) path += '/v1beta';
  url.pathname = `${path}/models/${encodeURIComponent(model)}:${action}`;
  if (action === 'streamGenerateContent') url.searchParams.set('alt', 'sse');
  return url.toString();
}

export function buildGeminiModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/v1$/.test(path)) path = path.slice(0, -3);
  if (!/\/v1beta$/.test(path)) path += '/v1beta';
  url.pathname = `${path}/models`.replace(/\/{2,}/g, '/');
  return url.toString();
}

function uniqueModels(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

export function extractOpenAIModelIds(data: unknown): string[] {
  const body = data as {
    data?: Array<{ id?: unknown } | string>;
    models?: Array<{ id?: unknown } | string>;
  };
  const rows = Array.isArray(body?.data)
    ? body.data
    : Array.isArray(body?.models)
      ? body.models
      : [];
  const ids = rows
    .map((row) => (typeof row === 'string' ? row : typeof row?.id === 'string' ? row.id : ''))
    .filter((id) => id.length > 0);
  return uniqueModels(ids);
}

export function extractGeminiModelIds(data: unknown): string[] {
  const body = data as {
    models?: Array<{ name?: unknown; supportedGenerationMethods?: unknown }>;
  };
  const rows = Array.isArray(body?.models) ? body.models : [];
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row?.name !== 'string' || !row.name) continue;
    const methods = row.supportedGenerationMethods;
    // 兼容只列 embedding 等非对话模型的情况：有声明就只留能 generateContent 的
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
    ids.push(row.name.replace(/^models\//, ''));
  }
  return uniqueModels(ids);
}

export async function listProviderModels(config: ProviderConfig): Promise<string[]> {
  if (!config.baseUrl) throw new HttpError(400, '请填写 Base URL');

  const isGemini = config.kind === 'gemini';
  const url = isGemini
    ? buildGeminiModelsUrl(config.baseUrl)
    : buildOpenAIUrl(config.baseUrl, '/models');

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(config.extra?.headers ?? {}),
  };
  const lower = new Set(Object.keys(headers).map((key) => key.toLowerCase()));
  if (config.apiKey) {
    if (isGemini && !lower.has('x-goog-api-key')) headers['x-goog-api-key'] = config.apiKey;
    if (!isGemini && !lower.has('authorization')) headers.Authorization = `Bearer ${config.apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw networkError(error);
  }

  if (!res.ok) {
    throw new HttpError(400, `拉取模型失败（${res.status}）：${await readError(res, config.apiKey)}`);
  }

  const data = (await res.json().catch(() => null)) as unknown;
  if (data === null) {
    throw new HttpError(400, '接口返回了非 JSON 内容，请检查 Base URL 是否指到了正确的 API');
  }
  return isGemini ? extractGeminiModelIds(data) : extractOpenAIModelIds(data);
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

function networkError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) {
    return new HttpError(400, '连接超时（12 秒），该站可能没开 /models，直接手填模型名即可');
  }
  return new HttpError(400, `无法连接接口：${sanitize(message, '')}`);
}
