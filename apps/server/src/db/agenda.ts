import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';

export interface AgendaItem {
  id: string;
  character_id: string;
  date: string;
  content: string;
  created_at: number;
}

/** 角色在聊天里自己说的“今天要做什么” */
export function addAgendaItem(characterId: string, date: string, content: string): void {
  const text = content.trim().slice(0, 80);
  if (!text) return;
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM character_agenda WHERE character_id = ? AND date = ? AND content = ?')
    .get(characterId, date, text) as { id: string } | undefined;
  if (existing) return;
  db.prepare(
    'INSERT INTO character_agenda (id, character_id, date, content, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), characterId, date, text, Date.now());
}

export function listAgenda(characterId: string, date: string): string[] {
  const rows = getDb()
    .prepare(
      'SELECT content FROM character_agenda WHERE character_id = ? AND date = ? ORDER BY created_at ASC LIMIT 12',
    )
    .all(characterId, date) as unknown as Array<{ content: string }>;
  return rows.map((row) => row.content);
}
