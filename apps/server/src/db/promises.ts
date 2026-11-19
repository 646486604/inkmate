import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';

export interface PromiseRow {
  id: string;
  chat_id: string;
  character_id: string;
  due_at: number;
  note: string;
  status: string;
  message_id: string | null;
  created_at: number;
}

/** 角色答应过的“几点来找你” */
export function createPromise(input: {
  chatId: string;
  characterId: string;
  dueAt: number;
  note?: string;
}): PromiseRow {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO chat_promises (id, chat_id, character_id, due_at, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, input.chatId, input.characterId, input.dueAt, (input.note ?? '').slice(0, 200), now);
  return getDb()
    .prepare('SELECT * FROM chat_promises WHERE id = ?')
    .get(id) as unknown as PromiseRow;
}

/** 到点、还没发、且没有太陈旧（超过 6 小时就不再补发） */
export function listDuePromises(now = Date.now()): PromiseRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM chat_promises
       WHERE status = 'pending' AND due_at <= ? AND due_at > ?
       ORDER BY due_at ASC LIMIT 20`,
    )
    .all(now, now - 6 * 60 * 60_000) as unknown as PromiseRow[];
}

/** 给提示词用：这个会话接下来答应过什么 */
export function listUpcomingPromises(chatId: string, now = Date.now()): PromiseRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM chat_promises
       WHERE chat_id = ? AND status = 'pending' AND due_at > ?
       ORDER BY due_at ASC LIMIT 5`,
    )
    .all(chatId, now) as unknown as PromiseRow[];
}

export function markPromise(
  id: string,
  status: 'sent' | 'skipped',
  messageId: string | null = null,
): void {
  getDb()
    .prepare('UPDATE chat_promises SET status = ?, message_id = ? WHERE id = ?')
    .run(status, messageId, id);
}
