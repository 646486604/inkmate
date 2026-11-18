import { randomUUID } from 'node:crypto';
import {
  initiativeSchema,
  type CharacterInput,
  type CharacterPatch,
  type CharacterPublic,
  type Initiative,
} from '@inkmate/shared';
import { getDb } from './index.js';
import {
  getWorldBookIdsForCharacter,
  setWorldBookIdsForCharacter,
} from './world-books.js';

export interface CharacterRow {
  id: string;
  name: string;
  nickname: string;
  avatar: string;
  persona: string;
  provider_id: string | null;
  model: string;
  greeting: string;
  color: string;
  bubble_style: string;
  memory_limit: number;
  initiative_json: string;
  state_json: string;
  created_at: number;
  updated_at: number;
}

function parseInitiative(json: string): Initiative {
  try {
    return initiativeSchema.parse(JSON.parse(json));
  } catch {
    return initiativeSchema.parse({});
  }
}

function toPublic(row: CharacterRow): CharacterPublic {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    avatar: row.avatar,
    persona: row.persona,
    greeting: row.greeting,
    color: row.color,
    providerId: row.provider_id,
    model: row.model,
    memoryLimit: row.memory_limit,
    worldBookIds: getWorldBookIdsForCharacter(row.id),
    initiative: parseInitiative(row.initiative_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCharacters(): CharacterPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM characters ORDER BY created_at ASC')
    .all() as unknown as CharacterRow[];
  return rows.map(toPublic);
}

export function getCharacter(id: string): CharacterPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM characters WHERE id = ?')
    .get(id) as unknown as CharacterRow | undefined;
  return row ? toPublic(row) : null;
}

export function getCharacterRow(id: string): CharacterRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM characters WHERE id = ?')
      .get(id) as unknown as CharacterRow | undefined) ?? null
  );
}

export function createCharacter(input: CharacterInput): CharacterPublic {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO characters
        (id, name, nickname, avatar, persona, provider_id, model, greeting, color,
         bubble_style, memory_limit, initiative_json, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.nickname ?? '',
      input.avatar ?? '',
      input.persona ?? '',
      input.providerId ?? null,
      input.model ?? '',
      input.greeting ?? '',
      input.color ?? '#b4472f',
      'soft',
      input.memoryLimit ?? 40,
      JSON.stringify(input.initiative ?? {}),
      '{}',
      now,
      now,
    );
  const created = getCharacter(id);
  if (!created) throw new Error('角色创建失败');
  if (input.worldBookIds && input.worldBookIds.length > 0) {
    setWorldBookIdsForCharacter(id, input.worldBookIds);
  }
  return getCharacter(id) ?? created;
}

export function updateCharacter(id: string, patch: CharacterPatch): CharacterPublic | null {
  const existing = getCharacterRow(id);
  if (!existing) return null;

  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.nickname !== undefined) {
    sets.push('nickname = ?');
    values.push(patch.nickname);
  }
  if (patch.avatar !== undefined) {
    sets.push('avatar = ?');
    values.push(patch.avatar);
  }
  if (patch.persona !== undefined) {
    sets.push('persona = ?');
    values.push(patch.persona);
  }
  if (patch.providerId !== undefined) {
    sets.push('provider_id = ?');
    values.push(patch.providerId);
  }
  if (patch.model !== undefined) {
    sets.push('model = ?');
    values.push(patch.model);
  }
  if (patch.greeting !== undefined) {
    sets.push('greeting = ?');
    values.push(patch.greeting);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    values.push(patch.color);
  }
  if (patch.memoryLimit !== undefined) {
    sets.push('memory_limit = ?');
    values.push(patch.memoryLimit);
  }
  if (patch.initiative !== undefined) {
    sets.push('initiative_json = ?');
    values.push(JSON.stringify(patch.initiative));
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb()
      .prepare(`UPDATE characters SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  if (patch.name !== undefined || patch.nickname !== undefined) {
    const title =
      (patch.nickname ?? existing.nickname).trim() || (patch.name ?? existing.name).trim();
    getDb()
      .prepare("UPDATE chats SET title = ? WHERE character_id = ? AND kind = 'private'")
      .run(title, id);
  }

  if (patch.worldBookIds !== undefined) {
    setWorldBookIdsForCharacter(id, patch.worldBookIds);
  }
  return getCharacter(id);
}

export function deleteCharacter(id: string): boolean {
  const db = getDb();
  const existing = getCharacterRow(id);
  if (!existing) return false;

  db.exec('BEGIN');
  try {
    const chats = db
      .prepare('SELECT id FROM chats WHERE character_id = ?')
      .all(id) as unknown as Array<{ id: string }>;
    for (const chat of chats) {
      db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat.id);
      db.prepare('DELETE FROM chats WHERE id = ?').run(chat.id);
    }
    db.prepare('DELETE FROM character_world_books WHERE character_id = ?').run(id);
    db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
