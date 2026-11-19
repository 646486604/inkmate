import { getSetting, setSetting } from '../db/settings.js';
import type { StickerPublic } from '@inkmate/shared';

const KEY = 'stickers';

/** 兼容老数据：以前存的是纯 url 字符串数组 */
export function listStickers(): StickerPublic[] {
  const raw = getSetting<unknown>(KEY, []);
  if (!Array.isArray(raw)) return [];
  const out: StickerPublic[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ url: item, desc: '' });
      continue;
    }
    if (item && typeof item === 'object') {
      const url = (item as { url?: unknown }).url;
      if (typeof url !== 'string') continue;
      const desc = (item as { desc?: unknown }).desc;
      out.push({ url, desc: typeof desc === 'string' ? desc : '' });
    }
  }
  return out;
}

export function saveStickers(list: StickerPublic[]): void {
  setSetting(KEY, list);
}

/** 只给 AI 看有描述的，最多 40 条，避免提示词被撑爆 */
export function stickersForPrompt(): StickerPublic[] {
  return listStickers()
    .filter((item) => item.desc.trim().length > 0)
    .slice(0, 40);
}
