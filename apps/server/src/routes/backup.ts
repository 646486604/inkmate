import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/session.js';
import { HttpError } from '../lib/http-error.js';
import {
  createBackupZip,
  importBackupZip,
  listBackups,
} from '../services/backup.js';

const backupRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/export', async (_req, reply) => {
    const buffer = await createBackupZip();
    const date = new Date().toISOString().slice(0, 10);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="inkmate-backup-${date}.zip"`);
    reply.header('Content-Length', String(buffer.length));
    return reply.send(buffer);
  });

  app.get('/list', async () => ({ backups: listBackups() }));

  app.post('/import', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
    if (!file) throw new HttpError(400, '没有收到备份文件');
    const buffer = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(400, '备份文件太大');
    const result = await importBackupZip(buffer);
    return reply.send(result);
  });
};

export default backupRoutes;
