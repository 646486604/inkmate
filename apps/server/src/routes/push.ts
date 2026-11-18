import type { FastifyPluginAsync } from 'fastify';
import type { PushSubscription } from 'web-push';
import { requireAuth } from '../auth/session.js';
import { HttpError } from '../lib/http-error.js';
import {
  deletePushSubscription,
  getVapidPublicKey,
  savePushSubscription,
  sendTestPush,
} from '../services/push.js';

const pushRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/key', async () => ({ publicKey: getVapidPublicKey() }));

  app.post('/subscribe', async (req) => {
    const body = req.body as Partial<PushSubscription>;
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      throw new HttpError(400, '订阅信息不完整');
    }
    savePushSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return { ok: true };
  });

  app.post('/unsubscribe', async (req) => {
    const body = req.body as { endpoint?: string };
    if (body.endpoint) deletePushSubscription(body.endpoint);
    return { ok: true };
  });

  app.post('/test', async () => ({ sent: await sendTestPush() }));
};

export default pushRoutes;
