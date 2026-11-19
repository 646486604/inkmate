import { randomUUID } from 'node:crypto';
import type {
  ChatBubbleStyle,
  ChatMemberPublic,
  ChatPublic,
  CharacterPublic,
  MessageKind,
  MessagePage,
  MessagePublic,
  MessageRole,
} from '@inkmate/shared';
import { getDb } from './index.js';
import { getCharacter } from './characters.js';

export interface ChatRow {
  id: string;
  kind: string;
  title: string;
  character_id: string | null;
  user_name: string;
  user_persona: string;
  background: string;
  bubble_json: string;
  last_message_at: number | null;
  unread_count: number;
  created_at: number;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRole;
  sender_id: string;
  kind: MessageKind;
  content: string;
  meta_json: string;
  client_id: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  created_at: number;
}

interface ChatJoinRow extends ChatRow {
  character_name: string | null;
  character_nickname: string | null;
  character_avatar: string | null;
  character_color: string | null;
  last_message: string | null;
  last_message_kind: MessageKind | null;
}

interface MemberRow {
  character_id: string;
  nickname: string;
  persona_override: string;
  sort_order: number;
  name: string;
  character_nickname: string;
  avatar: string;
  color: string;
  persona: string;
}

export function getChatMembers(chatId: string): ChatMemberPublic[] {
  const rows = getDb()
    .prepare(
      `SELECT cm.character_id, cm.nickname, cm.persona_override, cm.sort_order,
              ch.name, ch.nickname AS character_nickname, ch.avatar, ch.color, ch.persona
       FROM chat_members cm
       JOIN characters ch ON ch.id = cm.character_id
       WHERE cm.chat_id = ?
       ORDER BY cm.sort_order ASC, ch.created_at ASC`,
    )
    .all(chatId) as unknown as MemberRow[];
  return rows.map((row) => ({
    characterId: row.character_id,
    name: row.name,
    nickname: row.nickname || row.character_nickname,
    avatar: row.avatar,
    color: row.color,
    persona: row.persona,
    personaOverride: row.persona_override,
    sortOrder: row.sort_order,
  }));
}

function parseMeta(json: string): Record<string, unknown> {
  try {
    const value = JSON.parse(json) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // ignore malformed legacy value
  }
  return {};
}

export function toMessagePublic(row: MessageRow): MessagePublic {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    senderId: row.sender_id,
    kind: row.kind,
    content: row.deleted_at ? '' : row.content,
    meta: parseMeta(row.meta_json),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
  };
}

function parseBubble(json: string | undefined): ChatBubbleStyle | null {
  if (!json) return null;
  try {
    const value = JSON.parse(json) as Partial<ChatBubbleStyle>;
    if (
      typeof value?.mineColor !== 'string' ||
      typeof value?.otherColor !== 'string' ||
      typeof value?.alpha !== 'number'
    ) {
      return null;
    }
    return {
      mineColor: value.mineColor,
      otherColor: value.otherColor,
      alpha: Math.min(1, Math.max(0.35, value.alpha)),
    };
  } catch {
    return null;
  }
}

function toChatPublic(row: ChatJoinRow): ChatPublic {
  return {
    id: row.id,
    kind: row.kind === 'group' ? 'group' : 'private',
    title: row.title,
    characterId: row.character_id,
    characterName: row.character_name ?? row.title,
    characterNickname: row.character_nickname ?? '',
    characterAvatar: row.character_avatar ?? '',
    characterColor: row.character_color ?? '#b4472f',
    members: row.kind === 'group' ? getChatMembers(row.id) : [],
    userName: row.user_name ?? '',
    userPersona: row.user_persona ?? '',
    background: row.background ?? '',
    bubble: parseBubble(row.bubble_json),
    lastMessage: row.last_message ?? '',
    lastMessageKind: row.last_message_kind ?? 'text',
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
    createdAt: row.created_at,
  };
}

const CHAT_SELECT = `
  SELECT c.*,
    ch.name AS character_name,
    ch.nickname AS character_nickname,
    ch.avatar AS character_avatar,
    ch.color AS character_color,
    (SELECT m.content FROM messages m
      WHERE m.chat_id = c.id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
    (SELECT m.kind FROM messages m
      WHERE m.chat_id = c.id AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_kind
  FROM chats c
  LEFT JOIN characters ch ON ch.id = c.character_id
`;

export function listChats(): ChatPublic[] {
  const rows = getDb()
    .prepare(`${CHAT_SELECT} ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`)
    .all() as unknown as ChatJoinRow[];
  return rows.map(toChatPublic);
}

export function getChat(id: string): ChatPublic | null {
  const row = getDb()
    .prepare(`${CHAT_SELECT} WHERE c.id = ?`)
    .get(id) as unknown as ChatJoinRow | undefined;
  return row ? toChatPublic(row) : null;
}

export function getChatRow(id: string): ChatRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM chats WHERE id = ?')
      .get(id) as unknown as ChatRow | undefined) ?? null
  );
}

export function getPrivateChatForCharacter(characterId: string): ChatPublic | null {
  const row = getDb()
    .prepare("SELECT * FROM chats WHERE character_id = ? AND kind = 'private' LIMIT 1")
    .get(characterId) as unknown as ChatRow | undefined;
  return row ? getChat(row.id) : null;
}

export function createChatForCharacter(character: CharacterPublic): {
  chat: ChatPublic;
  created: boolean;
} {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM chats WHERE character_id = ? AND kind = 'private' LIMIT 1")
    .get(character.id) as unknown as ChatRow | undefined;
  if (existing) {
    const chat = getChat(existing.id);
    if (chat) return { chat, created: false };
  }

  const id = randomUUID();
  const now = Date.now();
  const title = character.nickname.trim() || character.name;
  db.prepare(
    'INSERT INTO chats (id, kind, title, character_id, last_message_at, unread_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
  ).run(id, 'private', title, character.id, null, now);

  if (character.greeting.trim()) {
    insertMessage({
      chatId: id,
      role: 'assistant',
      senderId: character.id,
      kind: 'text',
      content: character.greeting.trim(),
    });
    touchChat(id, 0);
  }

  const chat = getChat(id);
  if (!chat) throw new Error('会话创建失败');
  return { chat, created: true };
}

export function createGroupChat(
  title: string,
  characterIds: string[],
): { chat: ChatPublic; created: boolean } {
  const db = getDb();
  const characters: CharacterPublic[] = [];
  const seen = new Set<string>();
  for (const id of characterIds) {
    if (seen.has(id)) continue;
    const character = getCharacter(id);
    if (character) {
      characters.push(character);
      seen.add(id);
    }
  }
  if (characters.length < 2) throw new Error('至少需要两个有效角色');

  const id = randomUUID();
  const now = Date.now();
  db.exec('BEGIN');
  try {
    db.prepare(
      "INSERT INTO chats (id, kind, title, character_id, last_message_at, unread_count, created_at) VALUES (?, 'group', ?, NULL, NULL, 0, ?)",
    ).run(id, title, now);
    const insert = db.prepare(
      `INSERT INTO chat_members
        (chat_id, character_id, nickname, persona_override, sort_order)
       VALUES (?, ?, ?, '', ?)`,
    );
    characters.slice(0, 6).forEach((character, index) => {
      insert.run(id, character.id, character.nickname.trim() || character.name, index);
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const chat = getChat(id);
  if (!chat) throw new Error('群聊创建失败');
  return { chat, created: true };
}

export function deleteChat(id: string): boolean {
  const db = getDb();
  const existing = getChatRow(id);
  if (!existing) return false;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM chat_promises WHERE chat_id = ?').run(id);
    db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** 会话级「我」的身份；空串表示沿用全局 */
export function updateChatIdentity(
  id: string,
  patch: {
    userName?: string;
    userPersona?: string;
    background?: string;
    bubble?: ChatBubbleStyle | null;
  },
): ChatPublic | null {
  if (!getChatRow(id)) return null;
  const sets: string[] = [];
  const values: string[] = [];
  if (patch.userName !== undefined) {
    sets.push('user_name = ?');
    values.push(patch.userName);
  }
  if (patch.userPersona !== undefined) {
    sets.push('user_persona = ?');
    values.push(patch.userPersona);
  }
  if (patch.background !== undefined) {
    sets.push('background = ?');
    values.push(patch.background);
  }
  if (patch.bubble !== undefined) {
    sets.push('bubble_json = ?');
    values.push(patch.bubble === null ? '' : JSON.stringify(patch.bubble));
  }
  if (sets.length > 0) {
    values.push(id);
    getDb().prepare(`UPDATE chats SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  return getChat(id);
}

export function clearChat(id: string): void {  const db = getDb();
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
  db.prepare('UPDATE chats SET unread_count = 0, last_message_at = NULL WHERE id = ?').run(id);
}

export function markChatRead(id: string): void {
  getDb().prepare('UPDATE chats SET unread_count = 0 WHERE id = ?').run(id);
}

export function touchChat(id: string, unreadDelta: number): void {
  const now = Date.now();
  getDb()
    .prepare(
      'UPDATE chats SET last_message_at = ?, unread_count = MAX(0, unread_count + ?) WHERE id = ?',
    )
    .run(now, unreadDelta, id);
}

export interface InsertMessageInput {
  chatId: string;
  role: MessageRole;
  senderId: string;
  kind?: MessageKind;
  content: string;
  meta?: Record<string, unknown>;
  clientId?: string;
  createdAt?: number;
}

export function insertMessage(input: InsertMessageInput): MessagePublic {
  const id = randomUUID();
  const createdAt = input.createdAt ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO messages
        (id, chat_id, role, sender_id, kind, content, meta_json, client_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.chatId,
      input.role,
      input.senderId,
      input.kind ?? 'text',
      input.content,
      JSON.stringify(input.meta ?? {}),
      input.clientId ?? null,
      createdAt,
    );
  const row = getDb()
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as unknown as MessageRow;
  return toMessagePublic(row);
}

export function getMessage(id: string): MessagePublic | null {
  const row = getDb()
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(id) as unknown as MessageRow | undefined;
  return row ? toMessagePublic(row) : null;
}

export function getRecentMessages(chatId: string, limit: number): MessagePublic[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(chatId, limit) as unknown as MessageRow[];
  return rows.reverse().map(toMessagePublic);
}

export function listMessages(chatId: string, limit: number, before?: number): MessagePage {
  const db = getDb();
  const safeLimit = Math.min(80, Math.max(1, limit));
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND deleted_at IS NULL AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(chatId, before ?? null, before ?? null, safeLimit + 1) as unknown as MessageRow[];

  const hasMore = rows.length > safeLimit;
  if (hasMore) rows.pop();
  return { messages: rows.reverse().map(toMessagePublic), hasMore };
}

export function getLastAssistantMessage(chatId: string): MessagePublic | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND role = 'assistant' AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(chatId) as unknown as MessageRow | undefined;
  return row ? toMessagePublic(row) : null;
}

export function getLastUserMessage(chatId: string): MessagePublic | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM messages
       WHERE chat_id = ? AND role = 'user' AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(chatId) as unknown as MessageRow | undefined;
  return row ? toMessagePublic(row) : null;
}

export function getLastMessage(chatId: string): MessagePublic | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM messages WHERE chat_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(chatId) as unknown as MessageRow | undefined;
  return row ? toMessagePublic(row) : null;
}

export function updateMessageContent(id: string, content: string): MessagePublic | null {
  const now = Date.now();
  const result = getDb()
    .prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?')
    .run(content, now, id);
  if (Number(result.changes) === 0) return null;
  return getMessage(id);
}

export function softDeleteMessage(id: string): MessagePublic | null {
  const now = Date.now();
  const result = getDb()
    .prepare("UPDATE messages SET deleted_at = ?, content = '' WHERE id = ?")
    .run(now, id);
  if (Number(result.changes) === 0) return null;
  return getMessage(id);
}

export function hardDeleteMessage(id: string): boolean {
  const result = getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
  return Number(result.changes) > 0;
}
