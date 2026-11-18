import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import AdmZip from 'adm-zip';
import { backupsDir, dataDir, musicDir, uploadsDir, appSecretPath } from '../env.js';
import { closeDb, getDb } from '../db/index.js';
import { HttpError } from '../lib/http-error.js';

function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function tempPath(name: string): string {
  const dir = join(dataDir, '.backup-tmp');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${Date.now()}-${name}`);
}

export async function snapshotDatabase(target: string): Promise<void> {
  await backup(getDb(), target);
}

export async function createBackupZip(): Promise<Buffer> {
  const snapshot = tempPath('inkmate.db');
  try {
    await snapshotDatabase(snapshot);
    const zip = new AdmZip();
    zip.addLocalFile(snapshot, '', 'inkmate.db');
    zip.addFile(
      'backup.json',
      Buffer.from(
        JSON.stringify(
          {
            app: 'inkmate',
            version: 1,
            createdAt: Date.now(),
            includes: ['inkmate.db', 'uploads/', 'music/', 'app-secret', 'vapid.json'],
          },
          null,
          2,
        ),
      ),
    );
    if (existsSync(appSecretPath)) {
      zip.addLocalFile(appSecretPath, '', 'app-secret');
    }
    const vapidPath = join(dataDir, 'vapid.json');
    if (existsSync(vapidPath)) {
      zip.addLocalFile(vapidPath, '', 'vapid.json');
    }
    if (existsSync(uploadsDir) && readdirSync(uploadsDir).length > 0) {
      zip.addLocalFolder(uploadsDir, 'uploads');
    }
    if (existsSync(musicDir) && readdirSync(musicDir).length > 0) {
      zip.addLocalFolder(musicDir, 'music');
    }
    return zip.toBuffer();
  } finally {
    rmSync(snapshot, { force: true });
  }
}

export async function ensureDailyBackup(): Promise<string | null> {
  const target = join(backupsDir, `inkmate-${dayKey()}.db`);
  if (existsSync(target)) return target;
  const temp = tempPath('daily.db');
  try {
    await snapshotDatabase(temp);
    copyFileSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
  const files = readdirSync(backupsDir)
    .filter((file) => /^inkmate-\d{4}-\d{2}-\d{2}\.db$/.test(file))
    .sort();
  for (const file of files.slice(0, Math.max(0, files.length - 7))) {
    rmSync(join(backupsDir, file), { force: true });
  }
  return target;
}

export function startBackupScheduler(): () => void {
  const run = () => {
    void ensureDailyBackup().catch(() => undefined);
  };
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

function validateDatabase(path: string): void {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = new Set(tables.map((table) => table.name));
    if (!names.has('users') || !names.has('chats') || !names.has('messages')) {
      throw new Error('缺少核心数据表');
    }
    db.close();
  } catch (error) {
    db?.close();
    throw new HttpError(400, `备份数据库无效：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

function restoreMedia(zip: AdmZip, prefix: 'uploads' | 'music', targetDir: string): number {
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith(`${prefix}/`));
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  let restored = 0;
  for (const entry of entries) {
    const relative = entry.entryName.slice(prefix.length + 1);
    if (!relative || relative.includes('..') || relative.startsWith('/') || relative.includes('\\')) {
      continue;
    }
    const destination = join(targetDir, relative);
    mkdirSync(join(destination, '..'), { recursive: true });
    writeFileSync(destination, entry.getData());
    restored += 1;
  }
  return restored;
}

export async function importBackupZip(buffer: Buffer): Promise<{
  imported: boolean;
  media: number;
}> {
  const zip = new AdmZip(buffer);
  const dbEntry = zip.getEntry('inkmate.db');
  if (!dbEntry) throw new HttpError(400, '备份里没有 inkmate.db');
  const extracted = tempPath('restore.db');
  writeFileSync(extracted, dbEntry.getData());
  try {
    validateDatabase(extracted);
    const safety = join(backupsDir, `pre-import-${Date.now()}.db`);
    await snapshotDatabase(safety);
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const file = join(dataDir, `inkmate.db${suffix}`);
      if (existsSync(file)) rmSync(file, { force: true });
    }
    copyFileSync(extracted, join(dataDir, 'inkmate.db'));
    const media =
      restoreMedia(zip, 'uploads', uploadsDir) + restoreMedia(zip, 'music', musicDir);
    const secretEntry = zip.getEntry('app-secret');
    if (secretEntry) writeFileSync(appSecretPath, secretEntry.getData(), { mode: 0o600 });
    const vapidEntry = zip.getEntry('vapid.json');
    if (vapidEntry) writeFileSync(join(dataDir, 'vapid.json'), vapidEntry.getData(), { mode: 0o600 });
    getDb();
    return { imported: true, media };
  } finally {
    rmSync(extracted, { force: true });
  }
}

export function listBackups(): Array<{ name: string; size: number; createdAt: number }> {
  return readdirSync(backupsDir)
    .filter((file) => file.endsWith('.db'))
    .map((file) => {
      const path = join(backupsDir, file);
      const stat = statSync(path);
      return { name: basename(file), size: stat.size, createdAt: stat.mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}
