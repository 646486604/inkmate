import { randomUUID } from 'node:crypto';
import type {
  ChatSummaryPublic,
  FactInput,
  FactPatch,
  FactPublic,
  MemoryPublic,
} from '@inkmate/shared';
import { getDb } from './index.js';

interface SummaryRow {
  chat_id: string;
  content: string;
  message_count: number;
  updated_at: number;
}

interface FactRow {
  id: string;
  chat_id: string;
  content: string;
  importance: number;
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
}

function toSummary(row: SummaryRow | undefined): ChatSummaryPublic | null {
  if (!row) return null;
  return {
    content: row.content,
    messageCount: row.message_count,
    updatedAt: row.updated_at,
  };
}

function toFact(row: FactRow): FactPublic {
  return {
    id: row.id,
    chatId: row.chat_id,
    content: row.content,
    importance: row.importance,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getSummary(chatId: string): ChatSummaryPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM chat_summaries WHERE chat_id = ?')
    .get(chatId) as unknown as SummaryRow | undefined;
  return toSummary(row);
}

export function listFacts(chatId: string): FactPublic[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM chat_facts WHERE chat_id = ? ORDER BY importance DESC, updated_at DESC',
    )
    .all(chatId) as unknown as FactRow[];
  return rows.map(toFact);
}

export function getMemory(chatId: string): MemoryPublic {
  return { summary: getSummary(chatId), facts: listFacts(chatId) };
}

export function upsertSummary(
  chatId: string,
  content: string,
  messageCount: number,
): ChatSummaryPublic {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO chat_summaries (chat_id, content, message_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         content = excluded.content,
         message_count = excluded.message_count,
         updated_at = excluded.updated_at`,
    )
    .run(chatId, content, messageCount, now);
  return { content, messageCount, updatedAt: now };
}

export function addFacts(
  chatId: string,
  facts: Array<{ content: string; importance?: number; sourceMessageId?: string | null }>,
): FactPublic[] {
  const db = getDb();
  const now = Date.now();
  const existing = new Set(
    listFacts(chatId).map((fact) => fact.content.trim().toLowerCase()),
  );
  const created: FactPublic[] = [];
  for (const fact of facts) {
    const content = fact.content.trim();
    if (!content) continue;
    const key = content.toLowerCase();
    if (existing.has(key)) continue;
    const id = randomUUID();
    db.prepare(
      `INSERT INTO chat_facts
        (id, chat_id, content, importance, source_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      chatId,
      content,
      Math.min(5, Math.max(1, Math.round(fact.importance ?? 3))),
      fact.sourceMessageId ?? null,
      now,
      now,
    );
    existing.add(key);
    const row = db.prepare('SELECT * FROM chat_facts WHERE id = ?').get(id) as unknown as FactRow;
    created.push(toFact(row));
  }

  const count = (db.prepare('SELECT COUNT(*) AS c FROM chat_facts WHERE chat_id = ?').get(chatId) as {
    c: number;
  }).c;
  if (count > 40) {
    db.prepare(
      `DELETE FROM chat_facts WHERE id IN (
         SELECT id FROM chat_facts WHERE chat_id = ?
         ORDER BY importance ASC, created_at ASC LIMIT ?
       )`,
    ).run(chatId, count - 40);
  }
  return created;
}

export function createFact(chatId: string, input: FactInput): FactPublic {
  const created = addFacts(chatId, [
    { content: input.content, importance: input.importance },
  ]);
  if (!created[0]) {
    const existing = listFacts(chatId).find(
      (fact) => fact.content.trim().toLowerCase() === input.content.trim().toLowerCase(),
    );
    if (existing) return existing;
    throw new Error('事实创建失败');
  }
  return created[0];
}

export function updateFact(id: string, patch: FactPatch): FactPublic | null {
  const existing = getDb()
    .prepare('SELECT * FROM chat_facts WHERE id = ?')
    .get(id) as unknown as FactRow | undefined;
  if (!existing) return null;
  const sets: string[] = [];
  const values: Array<string | number> = [];
  if (patch.content !== undefined) {
    sets.push('content = ?');
    values.push(patch.content);
  }
  if (patch.importance !== undefined) {
    sets.push('importance = ?');
    values.push(patch.importance);
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    getDb()
      .prepare(`UPDATE chat_facts SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  const row = getDb()
    .prepare('SELECT * FROM chat_facts WHERE id = ?')
    .get(id) as unknown as FactRow;
  return toFact(row);
}

export function deleteFact(id: string): boolean {
  const result = getDb().prepare('DELETE FROM chat_facts WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}

export function countChatMessages(chatId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE chat_id = ? AND deleted_at IS NULL')
    .get(chatId) as { c: number };
  return row.c;
}
