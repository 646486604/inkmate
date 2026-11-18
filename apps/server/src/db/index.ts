import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { dataDir } from '../env.js';
import { SCHEMA_SQL } from './schema.js';
import { migrate } from './migrate.js';

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(join(dataDir, 'inkmate.db'));
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_SQL);
    migrate(db);
  }
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}
