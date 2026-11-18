import { createCipheriv, createDecipheriv, scryptSync, randomBytes } from 'node:crypto';
import { appSecret } from '../env.js';

const KEY = scryptSync(appSecret, 'inkmate-provider-key-v1', 32);
const VERSION = 'v1';

/** AES-256-GCM：v1.<iv>.<tag>.<ciphertext>（base64url） */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const [version, ivText, tagText, dataText] = payload.split('.');
  if (version !== VERSION || !ivText || !tagText || !dataText) {
    throw new Error('密钥格式不正确');
  }
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '••••••••';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}
