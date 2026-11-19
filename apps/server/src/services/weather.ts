import { getSetting } from '../db/settings.js';

interface WeatherCache {
  city: string;
  text: string;
  at: number;
}

let cache: WeatherCache | null = null;
const CACHE_MS = 30 * 60 * 1000;

const WMO: Record<number, string> = {
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '有雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小雨',
  55: '中雨',
  56: '冻毛毛雨',
  57: '冻雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨',
  81: '强阵雨',
  82: '暴雨',
  85: '阵雪',
  86: '强阵雪',
  95: '雷阵雨',
  96: '雷阵雨伴冰雹',
  99: '强雷暴伴冰雹',
};

function describe(code: unknown): string {
  const key = Number(code);
  return WMO[key] ?? '';
}

export function getWeatherCity(): string {
  return getSetting<string>('weather_city', '').trim();
}

/**
 * 用 Open-Meteo（免费、无需 key）取当天天气，失败时返回空串——
 * 天气拿不到不能让聊天/计划整个失败。
 */
export async function getWeatherText(city = getWeatherCity()): Promise<string> {
  const name = city.trim();
  if (!name) return '';
  if (cache && cache.city === name && Date.now() - cache.at < CACHE_MS) return cache.text;

  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    const geo = (await geoRes.json()) as {
      results?: Array<{ latitude: number; longitude: number; name?: string; admin1?: string }>;
    };
    const place = geo.results?.[0];
    if (!place) return '';

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        '&current=temperature_2m,weather_code' +
        '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
        '&timezone=auto&forecast_days=1',
      { signal: AbortSignal.timeout(8_000) },
    );
    const wx = (await wxRes.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
      daily?: {
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
      };
    };

    const desc = describe(wx.daily?.weather_code?.[0] ?? wx.current?.weather_code);
    const max = wx.daily?.temperature_2m_max?.[0];
    const min = wx.daily?.temperature_2m_min?.[0];
    const now = wx.current?.temperature_2m;
    if (desc === '' && max === undefined) return '';

    const parts = [
      desc,
      min !== undefined && max !== undefined ? `${Math.round(min)}–${Math.round(max)}°C` : '',
      now !== undefined ? `现在 ${Math.round(now)}°C` : '',
    ].filter(Boolean);

    const text = `${place.name ?? name}今天${parts.join('，')}`;
    cache = { city: name, text, at: Date.now() };
    return text;
  } catch {
    return '';
  }
}
