import type { DatabaseSync } from 'node:sqlite';

interface ColumnInfo {
  name: string;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as ColumnInfo[];
  return rows.some((row) => row.name === column);
}

function addColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** M0 的库升级到 M1；新库建表时已经带齐字段，这里只做兜底。 */
export function migrate(db: DatabaseSync): void {
  addColumn(db, 'characters', 'provider_id', 'TEXT');
  addColumn(db, 'characters', 'model', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'characters', 'greeting', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'characters', 'color', "TEXT NOT NULL DEFAULT '#b4472f'");
  addColumn(db, 'characters', 'bubble_style', "TEXT NOT NULL DEFAULT 'soft'");
  addColumn(db, 'characters', 'memory_limit', 'INTEGER NOT NULL DEFAULT 40');
  addColumn(db, 'characters', 'initiative_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'characters', 'state_json', "TEXT NOT NULL DEFAULT '{}'");

  addColumn(db, 'messages', 'sender_id', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
  addColumn(db, 'messages', 'meta_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumn(db, 'messages', 'client_id', 'TEXT');
  addColumn(db, 'messages', 'edited_at', 'INTEGER');
  addColumn(db, 'messages', 'deleted_at', 'INTEGER');

  // 会话级「我」的身份：空串表示沿用全局 user.persona / displayName
  addColumn(db, 'chats', 'user_name', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'chats', 'user_persona', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'chats', 'background', "TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'chats', 'bubble_json', "TEXT NOT NULL DEFAULT ''");
}
