import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import authRoutes from './routes/auth.js';
import providerRoutes from './routes/providers.js';
import characterRoutes from './routes/characters.js';
import chatRoutes from './routes/chats.js';
import messageRoutes from './routes/messages.js';
import uploadRoutes from './routes/uploads.js';
import mediaRoutes from './routes/media.js';
import worldBookRoutes from './routes/world-books.js';
import factRoutes from './routes/facts.js';
import eventRoutes from './routes/events.js';
import momentRoutes from './routes/moments.js';
import musicRoutes from './routes/music.js';
import pushRoutes from './routes/push.js';
import backupRoutes from './routes/backup.js';
import { startProactiveScheduler } from './services/schedule.js';
import { startMomentScheduler } from './services/moments.js';
import { startEventHeartbeat } from './services/events.js';
import { startBackupScheduler } from './services/backup.js';
import { getDb, closeDb } from './db/index.js';
import { seedInitialUser } from './db/seed.js';
import { getSessionUser } from './auth/session.js';
import { HttpError } from './lib/http-error.js';
import { dataDir, host, isProduction, port, webDist } from './env.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
});

await app.register(cookie);
await app.register(multipart, {
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

// 必须在注册路由/插件之前设置，子上下文才会继承这个错误处理器
app.setErrorHandler((error, req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: error.issues[0]?.message ?? '参数不正确' });
  }
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  req.log.error(error);
  const err = error as Error & { statusCode?: number };
  const statusCode =
    typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
  return reply.code(statusCode).send({
    error: statusCode >= 500 ? '服务器内部错误' : err.message,
  });
});

// 会话只解析一次，路由用 req.user 判断；静态资源也会走，但成本很低
app.addHook('onRequest', async (req) => {
  req.user = getSessionUser(req) ?? undefined;
});

if (isProduction) {
  app.addHook('onRequest', async (req, reply) => {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (!origin) return;
    try {
      if (new URL(origin).host !== req.headers.host) {
        return reply.code(403).send({ error: '跨站请求被拒绝' });
      }
    } catch {
      return reply.code(403).send({ error: '请求来源不合法' });
    }
  });
}

app.get('/api/health', async () => ({
  ok: true,
  name: 'inkmate',
  version: '0.1.0',
}));

await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(providerRoutes, { prefix: '/api/providers' });
await app.register(characterRoutes, { prefix: '/api/characters' });
await app.register(chatRoutes, { prefix: '/api/chats' });
await app.register(messageRoutes, { prefix: '/api/messages' });
await app.register(uploadRoutes, { prefix: '/api/uploads' });
await app.register(mediaRoutes, { prefix: '/media' });
await app.register(worldBookRoutes, { prefix: '/api/world-books' });
await app.register(factRoutes, { prefix: '/api/facts' });
await app.register(eventRoutes, { prefix: '/api/events' });
await app.register(momentRoutes, { prefix: '/api/moments' });
await app.register(musicRoutes, { prefix: '/api/music' });
await app.register(pushRoutes, { prefix: '/api/push' });
await app.register(backupRoutes, { prefix: '/api/backup' });

if (existsSync(join(webDist, 'index.html'))) {
  await app.register(fastifyStatic, {
    root: webDist,
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: '接口不存在' });
    }
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({
    name: 'inkmate',
    message: 'Web 尚未构建。开发时请访问 Vite 的 5173 端口；生产请先运行 npm run build。',
  }));
}

getDb();
seedInitialUser();

await app.listen({ port, host });
app.log.info(`[inkmate] data=${dataDir}`);
app.log.info(`[inkmate] open http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`);

const stopScheduler = startProactiveScheduler(app.log);
const stopMomentScheduler = startMomentScheduler(app.log);
const stopHeartbeat = startEventHeartbeat();
const stopBackup = startBackupScheduler();

const shutdown = async (signal: string) => {
  app.log.info(`[inkmate] ${signal}, shutting down`);
  stopScheduler();
  stopMomentScheduler();
  stopHeartbeat();
  stopBackup();
  await app.close();
  closeDb();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
