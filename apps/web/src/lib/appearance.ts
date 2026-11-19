export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSize = 'small' | 'standard' | 'large';

const STORAGE_KEY = 'inkmate-theme';
const FONT_KEY = 'inkmate-font-size';

export function getThemeMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = mode;
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#14100d' : '#f3ede2');
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  applyThemeMode(mode);
  // 气泡颜色默认跟随主题，切主题后要重新算一遍
  applyBubbleStyle(getBubbleStyle());
}

export function initAppearance(): void {
  applyThemeMode(getThemeMode());
  applyFontSize(getFontSize());
  applyBubbleStyle(getBubbleStyle());
}

export function getFontSize(): FontSize {
  try {
    const value = window.localStorage.getItem(FONT_KEY);
    if (value === 'small' || value === 'standard' || value === 'large') return value;
  } catch {
    // ignore
  }
  return 'standard';
}

export function applyFontSize(size: FontSize): void {
  document.documentElement.dataset.font = size;
}

export function setFontSize(size: FontSize): void {
  try {
    window.localStorage.setItem(FONT_KEY, size);
  } catch {
    // ignore
  }
  applyFontSize(size);
}

export interface BubbleStyle {
  mineColor: string;
  otherColor: string;
  /** 0.4 – 1，越低越透，背景会透出来 */
  alpha: number;
}

const BUBBLE_KEY = 'inkmate-bubbles';
export const BUBBLE_DEFAULTS: BubbleStyle = {
  mineColor: '#211c18',
  otherColor: '#fbf7f0',
  alpha: 1,
};

function isDarkTheme(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 没自定义过时，气泡颜色跟随主题 */
function themeDefaults(): BubbleStyle {
  return isDarkTheme()
    ? { mineColor: '#f6efe6', otherColor: '#2b241e', alpha: 1 }
    : { ...BUBBLE_DEFAULTS };
}

function clampAlpha(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return BUBBLE_DEFAULTS.alpha;
  return Math.min(1, Math.max(0.35, number));
}

export function getBubbleStyle(): BubbleStyle {
  try {
    const raw = window.localStorage.getItem(BUBBLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<BubbleStyle>;
      const fallback = themeDefaults();
      return {
        mineColor: typeof parsed.mineColor === 'string' ? parsed.mineColor : fallback.mineColor,
        otherColor:
          typeof parsed.otherColor === 'string' ? parsed.otherColor : fallback.otherColor,
        alpha: clampAlpha(parsed.alpha),
      };
    }
  } catch {
    // ignore
  }
  return themeDefaults();
}

function hexToRgbTriplet(hex: string): string {
  const value = hex.replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** 深色气泡配浅字、浅色气泡配深字 */
function readableText(hex: string): string {
  const [r, g, b] = hexToRgbTriplet(hex).split(' ').map(Number);
  const luminance = ((r ?? 0) * 299 + (g ?? 0) * 587 + (b ?? 0) * 114) / 1000;
  return luminance > 150 ? '27 22 18' : '255 250 242';
}

/** 给预览用的内联样式（和实际气泡算法一致） */
export function bubblePreviewStyle(
  color: string,
  alpha: number,
): { background: string; color: string } {
  const triplet = hexToRgbTriplet(color);
  const [r, g, b] = triplet.split(' ').map(Number);
  const luminance = ((r ?? 0) * 299 + (g ?? 0) * 587 + (b ?? 0) * 114) / 1000;
  return {
    background: `rgb(${triplet} / ${clampAlpha(alpha)})`,
    color: luminance > 150 ? 'rgb(27 22 18)' : 'rgb(255 250 242)',
  };
}

export function applyBubbleStyle(style: BubbleStyle = getBubbleStyle()): void {
  const root = document.documentElement;
  root.style.setProperty('--bubble-mine-rgb', hexToRgbTriplet(style.mineColor));
  root.style.setProperty('--bubble-other-rgb', hexToRgbTriplet(style.otherColor));
  root.style.setProperty('--bubble-mine-fg', readableText(style.mineColor));
  root.style.setProperty('--bubble-other-fg', readableText(style.otherColor));
  root.style.setProperty('--bubble-alpha', String(clampAlpha(style.alpha)));
}

export function setBubbleStyle(style: BubbleStyle): void {
  const normalized: BubbleStyle = { ...style, alpha: clampAlpha(style.alpha) };
  try {
    window.localStorage.setItem(BUBBLE_KEY, JSON.stringify(normalized));
  } catch {
    // ignore
  }
  applyBubbleStyle(normalized);
}

/** 清掉自定义，回到跟随主题的默认值 */
export function resetBubbleStyle(): BubbleStyle {
  try {
    window.localStorage.removeItem(BUBBLE_KEY);
  } catch {
    // ignore
  }
  const fallback = themeDefaults();
  applyBubbleStyle(fallback);
  return fallback;
}
