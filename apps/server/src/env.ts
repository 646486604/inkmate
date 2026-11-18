import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录：apps/server/{src,dist}/env.ts → ../../../ */
export const rootDir = fileURLToPath(new URL('../../../', import.meta.url));

export const dataDir = resolve(process.env.DATA_DIR ?? join(rootDir, 'data'));
mkdirSync(dataDir, { recursive: true });
export const uploadsDir = join(dataDir, 'uploads');
mkdirSync(uploadsDir, { recursive: true });
export const musicDir = join(dataDir, 'music');
mkdirSync(musicDir, { recursive: true });
export const backupsDir = join(dataDir, 'backups');
mkdirSync(backupsDir, { recursive: true });
export const neteaseApiUrl = process.env.NETEASE_API_URL ?? 'http://127.0.0.1:3000';

function loadAppSecret(): string {
  const fromEnv = process.env.APP_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  const secretFile = join(dataDir, '.app-secret');
  if (existsSync(secretFile)) {
    const existing = readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  }

  const generated = randomBytes(48).toString('base64url');
  writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

export const appSecretPath = join(dataDir, '.app-secret');
export const appSecret = loadAppSecret();
export const port = Number(process.env.PORT ?? 8787);
export const host = process.env.HOST ?? '127.0.0.1';
export const adminPassword = process.env.ADMIN_PASSWORD ?? 'inkmate';
export const isProduction = process.env.NODE_ENV === 'production';
export const cookieSecure = process.env.COOKIE_SECURE === 'true';
export const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
