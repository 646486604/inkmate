import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';

export interface OpenQuestionRow {
  id: string;
  chat_id: string;
  character_id: string;
  question: string;
  asked_at: number;
  followed_at: number | null;
  status: string;
  created_at: number;
}

/** 记下角色刚问出去的问题；同一个会话只保留最新一条未回的 */
export function setOpenQuestion(chatId: string, characterId: string, question: string): void {
  const text = question.trim().slice(0, 160);
  if (!text) return;
  const db = getDb();
  db.prepare(
    "UPDATE chat_open_questions SET status = 'answered' WHERE chat_id = ? AND status = 'open'",
  ).run(chatId);
  db.prepare(
    `INSERT INTO chat_open_questions (id, chat_id, character_id, question, asked_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
  ).run(randomUUID(), chatId, characterId, text, Date.now(), Date.now());
}

/** 用户说话了：之前的问题就算回应过了 */
export function clearOpenQuestions(chatId: string): void {
  getDb()
    .prepare("UPDATE chat_open_questions SET status = 'answered' WHERE chat_id = ? AND status = 'open'")
    .run(chatId);
}

/** 到点还没回、也没追问过的 */
export function listQuestionsToFollowUp(minAgeMs: number, now = Date.now()): OpenQuestionRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM chat_open_questions
       WHERE status = 'open' AND followed_at IS NULL AND asked_at <= ?
       ORDER BY asked_at ASC LIMIT 10`,
    )
    .all(now - minAgeMs) as unknown as OpenQuestionRow[];
}

export function markFollowedUp(id: string): void {
  getDb()
    .prepare("UPDATE chat_open_questions SET followed_at = ?, status = 'followed' WHERE id = ?")
    .run(Date.now(), id);
}
