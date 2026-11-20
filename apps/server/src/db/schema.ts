/**
 * M0 只建最小可用的表；后续里程碑用同一套 CREATE TABLE IF NOT EXISTS 增量补字段/表。
 * 时间统一存 epoch ms（INTEGER），方便排序和比较。
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '我',
  avatar TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_enc TEXT NOT NULL DEFAULT '',
  default_model TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

-- 角色卡：M1 增加 provider/model/greeting/主题色/记忆轮数
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  persona TEXT NOT NULL DEFAULT '',
  provider_id TEXT,
  model TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  social_circle TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#b4472f',
  bubble_style TEXT NOT NULL DEFAULT 'soft',
  memory_limit INTEGER NOT NULL DEFAULT 40,
  initiative_json TEXT NOT NULL DEFAULT '{}',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'private',
  title TEXT NOT NULL,
  character_id TEXT,
  user_name TEXT NOT NULL DEFAULT '',
  user_persona TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  bubble_json TEXT NOT NULL DEFAULT '',
  last_message_at INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_last ON chats(last_message_at);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL DEFAULT '',
  persona_override TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, character_id)
);

-- 角色在聊天里答应过的“某个时间来找你”，到点由调度器生成一条主动消息
CREATE TABLE IF NOT EXISTS chat_promises (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promises_due ON chat_promises(status, due_at);

-- 角色在聊天里自己提过的日程（"下午开会"这种），用来替代固定时间表
CREATE TABLE IF NOT EXISTS character_agenda (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agenda_character_date ON character_agenda(character_id, date);

-- 角色问过、但用户还没回的问题；过一阵可以自然地追问
CREATE TABLE IF NOT EXISTS chat_open_questions (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  question TEXT NOT NULL,
  asked_at INTEGER NOT NULL,
  followed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_open ON chat_open_questions(chat_id, status, asked_at);

CREATE TABLE IF NOT EXISTS world_books (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_book_entries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES world_books(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'before',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_world_entries_book ON world_book_entries(book_id, sort_order);

CREATE TABLE IF NOT EXISTS character_world_books (
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES world_books(id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, book_id)
);

CREATE TABLE IF NOT EXISTS chat_summaries (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_facts (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 3,
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_facts_chat ON chat_facts(chat_id, importance);

CREATE TABLE IF NOT EXISTS day_plans (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  day_type TEXT NOT NULL DEFAULT '',
  mood TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready',
  raw_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE(character_id, date)
);

CREATE TABLE IF NOT EXISTS day_beats (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  due_at INTEGER NOT NULL,
  activity TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  energy TEXT NOT NULL DEFAULT '',
  contact_worthy INTEGER NOT NULL DEFAULT 0,
  contact_intent TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_beats_due ON day_beats(status, due_at);
CREATE INDEX IF NOT EXISTS idx_beats_plan ON day_beats(plan_id, start_at);

CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  author_type TEXT NOT NULL DEFAULT 'character',
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  images_json TEXT NOT NULL DEFAULT '[]',
  mood TEXT NOT NULL DEFAULT '',
  plan_id TEXT,
  chat_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(created_at);
CREATE INDEX IF NOT EXISTS idx_moments_chat ON moments(chat_id, created_at);

CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (moment_id, actor_type, actor_id)
);

CREATE TABLE IF NOT EXISTS moment_comments (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
  author_type TEXT NOT NULL,
  author_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_comments ON moment_comments(moment_id, created_at);

CREATE TABLE IF NOT EXISTS moment_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'publish',
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  moment_id TEXT REFERENCES moments(id) ON DELETE CASCADE,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moment_jobs_due ON moment_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS music_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  album TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL,
  cover_path TEXT NOT NULL DEFAULT '',
  lyrics TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local',
  source_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS music_sessions (
  id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS music_comments (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_music_comments_track ON music_comments(track_id, created_at);

CREATE TABLE IF NOT EXISTS music_favorites (
  track_id TEXT PRIMARY KEY,
  track_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);


CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  sender_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  client_id TEXT,
  edited_at INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id, id);
`;
