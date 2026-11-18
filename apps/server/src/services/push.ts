import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import { dataDir } from '../env.js';
import { getDb } from '../db/index.js';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  keys_json: string;
}

let keys: VapidKeys | null = null;

function loadVapid(): VapidKeys {
  if (keys) return keys;
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;
  if (envPublic && envPrivate) {
    keys = { publicKey: envPublic, privateKey: envPrivate };
  } else {
    const path = join(dataDir, 'vapid.json');
    if (existsSync(path)) {
      keys = JSON.parse(readFileSync(path, 'utf8')) as VapidKeys;
    } else {
      const generated = webpush.generateVAPIDKeys();
      keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(path, JSON.stringify(keys), { mode: 0o600 });
    }
  }
  webpush.setVapidDetails('mailto:inkmate@localhost', keys.publicKey, keys.privateKey);
  return keys;
}

export function getVapidPublicKey(): string {
  return loadVapid().publicKey;
}

export function savePushSubscription(subscription: PushSubscription): void {
  const endpoint = subscription.endpoint;
  getDb()
    .prepare(
      `INSERT INTO push_subscriptions (id, endpoint, keys_json, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json`,
    )
    .run(randomUUID(), endpoint, JSON.stringify(subscription.keys), Date.now());
}

export function deletePushSubscription(endpoint: string): void {
  getDb().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export async function sendPushToAll(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<number> {
  loadVapid();
  const rows = getDb()
    .prepare('SELECT * FROM push_subscriptions')
    .all() as unknown as SubscriptionRow[];
  let sent = 0;
  for (const row of rows) {
    try {
      const subscription: PushSubscription = {
        endpoint: row.endpoint,
        keys: JSON.parse(row.keys_json) as PushSubscription['keys'],
      };
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        TTL: 60 * 60 * 12,
      });
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        deletePushSubscription(row.endpoint);
      }
    }
  }
  return sent;
}

export async function sendTestPush(): Promise<number> {
  return sendPushToAll({
    title: '墨伴 InkMate',
    body: '通知已连接。TA 想找你的时候，会在这里出现。',
    url: '/',
    tag: 'inkmate-test',
  });
}
