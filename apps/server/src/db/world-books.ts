import { randomUUID } from 'node:crypto';
import type {
  WorldBookEntryInput,
  WorldBookEntryPatch,
  WorldBookEntryPublic,
  WorldBookInput,
  WorldBookPatch,
  WorldBookPosition,
  WorldBookPublic,
} from '@inkmate/shared';
import { getDb } from './index.js';

interface BookRow {
  id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
}

interface EntryRow {
  id: string;
  book_id: string;
  title: string;
  content: string;
  position: string;
  enabled: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

function toEntry(row: EntryRow): WorldBookEntryPublic {
  return {
    id: row.id,
    bookId: row.book_id,
    title: row.title,
    content: row.content,
    position: row.position === 'after' ? 'after' : 'before',
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBook(row: BookRow, entries: WorldBookEntryPublic[]): WorldBookPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    entries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function entriesForBook(bookId: string): WorldBookEntryPublic[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM world_book_entries WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(bookId) as unknown as EntryRow[];
  return rows.map(toEntry);
}

export function listWorldBooks(): WorldBookPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM world_books ORDER BY created_at ASC')
    .all() as unknown as BookRow[];
  return rows.map((row) => toBook(row, entriesForBook(row.id)));
}

export function getWorldBook(id: string): WorldBookPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM world_books WHERE id = ?')
    .get(id) as unknown as BookRow | undefined;
  return row ? toBook(row, entriesForBook(id)) : null;
}

export function createWorldBook(input: WorldBookInput): WorldBookPublic {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO world_books (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, input.name, input.description ?? '', now, now);
  const created = getWorldBook(id);
  if (!created) throw new Error('世界书创建失败');
  return created;
}

export function updateWorldBook(id: string, patch: WorldBookPatch): WorldBookPublic | null {
  const existing = getWorldBook(id);
  if (!existing) return null;
  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    values.push(patch.description);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb()
      .prepare(`UPDATE world_books SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  return getWorldBook(id);
}

export function deleteWorldBook(id: string): boolean {
  const result = getDb().prepare('DELETE FROM world_books WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function createWorldBookEntry(
  bookId: string,
  input: WorldBookEntryInput,
): WorldBookEntryPublic | null {
  if (!getWorldBook(bookId)) return null;
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO world_book_entries
        (id, book_id, title, content, position, enabled, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      bookId,
      input.title ?? '',
      input.content,
      input.position ?? 'before',
      input.enabled === false ? 0 : 1,
      input.sortOrder ?? 0,
      now,
      now,
    );
  const row = getDb()
    .prepare('SELECT * FROM world_book_entries WHERE id = ?')
    .get(id) as unknown as EntryRow;
  return toEntry(row);
}

export function updateWorldBookEntry(
  bookId: string,
  entryId: string,
  patch: WorldBookEntryPatch,
): WorldBookEntryPublic | null {
  const existing = getDb()
    .prepare('SELECT * FROM world_book_entries WHERE id = ? AND book_id = ?')
    .get(entryId, bookId) as unknown as EntryRow | undefined;
  if (!existing) return null;

  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    values.push(patch.title);
  }
  if (patch.content !== undefined) {
    sets.push('content = ?');
    values.push(patch.content);
  }
  if (patch.position !== undefined) {
    sets.push('position = ?');
    values.push(patch.position);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.sortOrder !== undefined) {
    sets.push('sort_order = ?');
    values.push(patch.sortOrder);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(entryId);
    getDb()
      .prepare(`UPDATE world_book_entries SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  const row = getDb()
    .prepare('SELECT * FROM world_book_entries WHERE id = ?')
    .get(entryId) as unknown as EntryRow;
  return toEntry(row);
}

export function deleteWorldBookEntry(bookId: string, entryId: string): boolean {
  const result = getDb()
    .prepare('DELETE FROM world_book_entries WHERE id = ? AND book_id = ?')
    .run(entryId, bookId);
  return Number(result.changes) > 0;
}

export function getWorldBookIdsForCharacter(characterId: string): string[] {
  const rows = getDb()
    .prepare('SELECT book_id FROM character_world_books WHERE character_id = ?')
    .all(characterId) as unknown as Array<{ book_id: string }>;
  return rows.map((row) => row.book_id);
}

export function setWorldBookIdsForCharacter(characterId: string, bookIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM character_world_books WHERE character_id = ?').run(characterId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO character_world_books (character_id, book_id) VALUES (?, ?)',
  );
  for (const bookId of bookIds) {
    if (getWorldBook(bookId)) insert.run(characterId, bookId);
  }
}

export interface InjectedWorldEntry {
  title: string;
  content: string;
  position: WorldBookPosition;
  bookName: string;
}

/** 角色绑定的、启用的世界书条目，按书和条目顺序展开。 */
export function getWorldEntriesForCharacter(characterId: string): InjectedWorldEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT e.title, e.content, e.position, b.name AS book_name
       FROM character_world_books cw
       JOIN world_books b ON b.id = cw.book_id
       JOIN world_book_entries e ON e.book_id = b.id
       WHERE cw.character_id = ? AND e.enabled = 1
       ORDER BY b.created_at ASC, e.sort_order ASC, e.created_at ASC`,
    )
    .all(characterId) as unknown as Array<{
    title: string;
    content: string;
    position: string;
    book_name: string;
  }>;
  return rows.map((row) => ({
    title: row.title,
    content: row.content,
    position: row.position === 'after' ? 'after' : 'before',
    bookName: row.book_name,
  }));
}
