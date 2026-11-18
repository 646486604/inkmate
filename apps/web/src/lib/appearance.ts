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
}

export function initAppearance(): void {
  applyThemeMode(getThemeMode());
  applyFontSize(getFontSize());
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
