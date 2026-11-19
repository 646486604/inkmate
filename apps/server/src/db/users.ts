import type { PublicUser } from '@inkmate/shared';
import { getDb } from './index.js';

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar: string;
  persona: string;
}

export function getPrimaryUser(): PublicUser | null {
  const row = getDb()
    .prepare('SELECT id, username, display_name, avatar, persona FROM users ORDER BY created_at ASC LIMIT 1')
    .get() as unknown as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    persona: row.persona,
  };
}

/** 全局「我」的名字与人设；会话里没单独设置时用这份 */
export function updateUserProfile(
  id: string,
  patch: { displayName?: string; persona?: string; avatar?: string },
): PublicUser | null {
  const sets: string[] = [];
  const values: string[] = [];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.persona !== undefined) {
    sets.push('persona = ?');
    values.push(patch.persona);
  }
  if (patch.avatar !== undefined) {
    sets.push('avatar = ?');
    values.push(patch.avatar);
  }
  if (sets.length === 0) return getPrimaryUser();
  values.push(id);
  getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getPrimaryUser();
}
