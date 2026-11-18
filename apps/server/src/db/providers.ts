import { randomUUID } from 'node:crypto';
import type {
  ProviderExtra,
  ProviderInput,
  ProviderKind,
  ProviderPatch,
  ProviderPublic,
} from '@inkmate/shared';
import { getDb } from '../db/index.js';
import { decryptSecret, encryptSecret, maskSecret } from '../lib/crypto.js';
import { HttpError } from '../lib/http-error.js';

interface ProviderRow {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  api_key_enc: string;
  default_model: string;
  extra_json: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

function parseExtra(json: string): ProviderExtra | undefined {
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === 'object') return value as ProviderExtra;
  } catch {
    // ignore malformed legacy value
  }
  return undefined;
}

function maskKey(encrypted: string): string {
  if (!encrypted) return '';
  try {
    return maskSecret(decryptSecret(encrypted));
  } catch {
    return '••••（无法解密）';
  }
}

function toPublic(row: ProviderRow): ProviderPublic {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.base_url,
    model: row.default_model,
    enabled: row.enabled === 1,
    hasKey: Boolean(row.api_key_enc),
    maskedKey: maskKey(row.api_key_enc),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProviders(): ProviderPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM providers ORDER BY created_at ASC')
    .all() as unknown as ProviderRow[];
  return rows.map(toPublic);
}

export function getProvider(id: string): ProviderPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(id) as unknown as ProviderRow | undefined;
  return row ? toPublic(row) : null;
}

export function getProviderConfig(id: string): {
  provider: ProviderPublic;
  apiKey: string;
  extra?: ProviderExtra;
} | null {
  const row = getDb()
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(id) as unknown as ProviderRow | undefined;
  if (!row) return null;

  let apiKey = '';
  if (row.api_key_enc) {
    try {
      apiKey = decryptSecret(row.api_key_enc);
    } catch {
      throw new HttpError(500, 'API Key 无法解密，请重新保存该服务');
    }
  }
  return { provider: toPublic(row), apiKey, extra: parseExtra(row.extra_json) };
}

export function createProvider(input: ProviderInput): ProviderPublic {
  const now = Date.now();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO providers
        (id, name, kind, base_url, api_key_enc, default_model, extra_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.kind,
      input.baseUrl.replace(/\/+$/, ''),
      encryptSecret(input.apiKey ?? ''),
      input.model,
      JSON.stringify(input.extra ?? {}),
      input.enabled === false ? 0 : 1,
      now,
      now,
    );
  const created = getProvider(id);
  if (!created) throw new HttpError(500, '保存失败');
  return created;
}

export function updateProvider(id: string, patch: ProviderPatch): ProviderPublic | null {
  const existing = getDb()
    .prepare('SELECT * FROM providers WHERE id = ?')
    .get(id) as unknown as ProviderRow | undefined;
  if (!existing) return null;

  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.kind !== undefined) {
    sets.push('kind = ?');
    values.push(patch.kind);
  }
  if (patch.baseUrl !== undefined) {
    sets.push('base_url = ?');
    values.push(patch.baseUrl.replace(/\/+$/, ''));
  }
  if (patch.model !== undefined) {
    sets.push('default_model = ?');
    values.push(patch.model);
  }
  if (patch.apiKey !== undefined) {
    sets.push('api_key_enc = ?');
    values.push(encryptSecret(patch.apiKey));
  }
  if (patch.extra !== undefined) {
    sets.push('extra_json = ?');
    values.push(JSON.stringify(patch.extra));
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb()
      .prepare(`UPDATE providers SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const result = getDb().prepare('DELETE FROM providers WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
