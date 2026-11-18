import { randomUUID } from 'node:crypto';
import type { BeatStatus, DayBeatPublic, DayPlanPublic } from '@inkmate/shared';
import { getDb } from './index.js';

interface PlanRow {
  id: string;
  character_id: string;
  date: string;
  day_type: string;
  mood: string;
  summary: string;
  status: string;
  raw_json: string;
  created_at: number;
}

interface BeatRow {
  id: string;
  plan_id: string;
  start_at: number;
  end_at: number | null;
  due_at: number;
  activity: string;
  location: string;
  energy: string;
  contact_worthy: number;
  contact_intent: string;
  tone: string;
  status: string;
  message_id: string | null;
  attempts: number;
  created_at: number;
}

export interface DueBeat extends BeatRow {
  character_id: string;
  plan_date: string;
  mood: string;
  summary: string;
}

export interface NewBeat {
  startAt: number;
  endAt: number | null;
  dueAt: number;
  activity: string;
  location?: string;
  energy?: string;
  contactWorthy: boolean;
  contactIntent?: string;
  tone?: string;
}

function toBeat(row: BeatRow): DayBeatPublic {
  return {
    id: row.id,
    planId: row.plan_id,
    startAt: row.start_at,
    endAt: row.end_at,
    dueAt: row.due_at,
    activity: row.activity,
    location: row.location,
    energy: row.energy,
    contactWorthy: row.contact_worthy === 1,
    contactIntent: row.contact_intent,
    tone: row.tone,
    status: row.status as BeatStatus,
    messageId: row.message_id,
  };
}

function beatsForPlan(planId: string): DayBeatPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM day_beats WHERE plan_id = ? ORDER BY start_at ASC, created_at ASC')
    .all(planId) as unknown as BeatRow[];
  return rows.map(toBeat);
}

function toPlan(row: PlanRow): DayPlanPublic {
  return {
    id: row.id,
    characterId: row.character_id,
    date: row.date,
    dayType: row.day_type,
    mood: row.mood,
    summary: row.summary,
    status: row.status,
    beats: beatsForPlan(row.id),
    createdAt: row.created_at,
  };
}

export function getPlan(characterId: string, date: string): DayPlanPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM day_plans WHERE character_id = ? AND date = ?')
    .get(characterId, date) as unknown as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

export function getPlanById(planId: string): DayPlanPublic | null {
  const row = getDb()
    .prepare('SELECT * FROM day_plans WHERE id = ?')
    .get(planId) as unknown as PlanRow | undefined;
  return row ? toPlan(row) : null;
}

export function replacePlan(
  characterId: string,
  date: string,
  input: {
    dayType: string;
    mood: string;
    summary: string;
    raw: unknown;
    beats: NewBeat[];
  },
): DayPlanPublic {
  const db = getDb();
  const planId = randomUUID();
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const previous = db
      .prepare('SELECT id FROM day_plans WHERE character_id = ? AND date = ?')
      .get(characterId, date) as { id: string } | undefined;
    if (previous) {
      db.prepare('DELETE FROM day_beats WHERE plan_id = ?').run(previous.id);
      db.prepare('DELETE FROM day_plans WHERE id = ?').run(previous.id);
    }
    db.prepare(
      `INSERT INTO day_plans
        (id, character_id, date, day_type, mood, summary, status, raw_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)`,
    ).run(
      planId,
      characterId,
      date,
      input.dayType,
      input.mood,
      input.summary,
      JSON.stringify(input.raw ?? {}),
      now,
    );
    const insertBeat = db.prepare(
      `INSERT INTO day_beats
        (id, plan_id, start_at, end_at, due_at, activity, location, energy,
         contact_worthy, contact_intent, tone, status, message_id, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?)`,
    );
    for (const beat of input.beats) {
      insertBeat.run(
        randomUUID(),
        planId,
        beat.startAt,
        beat.endAt,
        beat.dueAt,
        beat.activity,
        beat.location ?? '',
        beat.energy ?? '',
        beat.contactWorthy ? 1 : 0,
        beat.contactIntent ?? '',
        beat.tone ?? '',
        now,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const plan = getPlanById(planId);
  if (!plan) throw new Error('日程保存失败');
  return plan;
}

export function listDueBeats(now: number, date: string): DueBeat[] {
  return getDb()
    .prepare(
      `SELECT b.*, p.character_id, p.date AS plan_date, p.mood, p.summary
       FROM day_beats b
       JOIN day_plans p ON p.id = b.plan_id
       WHERE b.status = 'pending' AND p.date = ? AND b.due_at <= ?
         AND b.contact_worthy = 1
       ORDER BY b.due_at ASC`,
    )
    .all(date, now) as unknown as DueBeat[];
}

export function countSentBeats(characterId: string, date: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM day_beats b
       JOIN day_plans p ON p.id = b.plan_id
       WHERE p.character_id = ? AND p.date = ? AND b.status = 'sent'`,
    )
    .get(characterId, date) as { c: number };
  return row.c;
}

export function lastSentBeat(characterId: string, date: string): DueBeat | null {
  return (
    (getDb()
      .prepare(
        `SELECT b.*, p.character_id, p.date AS plan_date, p.mood, p.summary
         FROM day_beats b JOIN day_plans p ON p.id = b.plan_id
         WHERE p.character_id = ? AND p.date = ? AND b.status = 'sent'
         ORDER BY b.due_at DESC LIMIT 1`,
      )
      .get(characterId, date) as unknown as DueBeat | undefined) ?? null
  );
}

export function nextPendingBeat(characterId: string, date: string): DueBeat | null {
  return (
    (getDb()
      .prepare(
        `SELECT b.*, p.character_id, p.date AS plan_date, p.mood, p.summary
         FROM day_beats b JOIN day_plans p ON p.id = b.plan_id
         WHERE p.character_id = ? AND p.date = ? AND b.status = 'pending'
           AND b.contact_worthy = 1
         ORDER BY b.due_at ASC LIMIT 1`,
      )
      .get(characterId, date) as unknown as DueBeat | undefined) ?? null
  );
}

export function currentBeat(characterId: string, date: string, now: number): DueBeat | null {
  return (
    (getDb()
      .prepare(
        `SELECT b.*, p.character_id, p.date AS plan_date, p.mood, p.summary
         FROM day_beats b JOIN day_plans p ON p.id = b.plan_id
         WHERE p.character_id = ? AND p.date = ? AND b.start_at <= ?
         ORDER BY b.start_at DESC LIMIT 1`,
      )
      .get(characterId, date, now) as unknown as DueBeat | undefined) ?? null
  );
}

export function nextBeat(characterId: string, date: string, now: number): DueBeat | null {
  return (
    (getDb()
      .prepare(
        `SELECT b.*, p.character_id, p.date AS plan_date, p.mood, p.summary
         FROM day_beats b JOIN day_plans p ON p.id = b.plan_id
         WHERE p.character_id = ? AND p.date = ? AND b.start_at > ?
         ORDER BY b.start_at ASC LIMIT 1`,
      )
      .get(characterId, date, now) as unknown as DueBeat | undefined) ?? null
  );
}

export function markBeatSent(id: string, messageId: string): void {
  getDb()
    .prepare("UPDATE day_beats SET status = 'sent', message_id = ? WHERE id = ?")
    .run(messageId, id);
}

export function markBeatSkipped(id: string): void {
  getDb().prepare("UPDATE day_beats SET status = 'skipped' WHERE id = ?").run(id);
}

export function markBeatMissed(id: string): void {
  getDb().prepare("UPDATE day_beats SET status = 'missed' WHERE id = ?").run(id);
}

export function incrementBeatAttempts(id: string): number {
  getDb().prepare('UPDATE day_beats SET attempts = attempts + 1 WHERE id = ?').run(id);
  const row = getDb().prepare('SELECT attempts FROM day_beats WHERE id = ?').get(id) as
    | { attempts: number }
    | undefined;
  return row?.attempts ?? 0;
}
