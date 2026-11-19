import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/session.js';
import { getSetting, setSetting } from '../db/settings.js';
import { getWeatherCity } from '../services/weather.js';

const settingsPatchSchema = z.object({
  weatherCity: z.string().trim().max(60, '城市名最多 60 个字').optional(),
});

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => ({ weatherCity: getWeatherCity() }));

  app.put('/', async (req) => {
    const input = settingsPatchSchema.parse(req.body);
    if (input.weatherCity !== undefined) {
      setSetting('weather_city', input.weatherCity);
    }
    return { weatherCity: getSetting<string>('weather_city', '').trim() };
  });
};

export default settingsRoutes;
