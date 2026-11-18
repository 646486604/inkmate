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
