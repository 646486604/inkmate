import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { getSetting, setSetting } from '../db/settings.js';
import { getWeatherCity, getWeatherText } from '../services/weather.js';

const settingsPatchSchema = z.object({
  weatherCity: z.string().trim().max(60, '城市名最多 60 个字').optional(),
});

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ weatherCity: getWeatherCity() }));

  // 让用户能直接看到天气到底取到了什么，而不是只能猜
  app.get('/weather', async () => {
    const city = getWeatherCity();
    if (!city) return { city: '', text: '', error: '还没设置城市' };
    const text = await getWeatherText(city);
    return {
      city,
      text,
      error: text ? '' : '取不到：检查城市名（建议用「杭州」这种写法）或网络',
    };
  });

  app.put('/', async (req) => {
    const input = settingsPatchSchema.parse(req.body);
    if (input.weatherCity !== undefined) {
      setSetting('weather_city', input.weatherCity);
    }
    return { weatherCity: getSetting<string>('weather_city', '').trim() };
  });
};

export default settingsRoutes;
