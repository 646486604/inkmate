import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import { hashPassword } from '../auth/password.js';
import { adminPassword } from '../env.js';

export function seedInitialUser(): void {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (row.c > 0) return;

  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, avatar, persona, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), 'me', hashPassword(adminPassword), '我', '', '', now);

  const hint =
    adminPassword === 'inkmate'
      ? 'inkmate（默认密码，请在设置里尽快修改）'
      : '来自 ADMIN_PASSWORD';
  console.log(`[inkmate] 已创建初始账号 me，密码：${hint}`);
}
