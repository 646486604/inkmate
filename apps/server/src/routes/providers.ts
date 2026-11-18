import type { FastifyPluginAsync } from 'fastify';
import {
  providerInputSchema,
  providerModelsInputSchema,
  providerPatchSchema,
} from '@inkmate/shared';
import {
  createProvider,
  deleteProvider,
  getProviderConfig,
  listProviders,
  updateProvider,
} from '../db/providers.js';
import { requireAuth } from '../auth/session.js';
import { HttpError } from '../lib/http-error.js';
import { listProviderModels } from '../llm/provider.js';

// 手机上从聊天/备忘录复制 key，很容易带上换行、全角空格、零宽字符，
// 或者连着 "Bearer " 前缀、引号一起复制；这些都会让上游报 401 invalid api key。
function cleanKey(value: string): string {
  return value
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, '')
    .replace(/^bearer/i, '')
    .replace(/^["'`]+|["'`]+$/g, '');
}

const providerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => {
    return { providers: listProviders() };
  });

  app.post('/', async (req, reply) => {
    const input = providerInputSchema.parse(req.body);
    const provider = createProvider({ ...input, apiKey: cleanKey(input.apiKey) });
    return reply.code(201).send({ provider });
  });

  // 表单里还没保存时也能拉列表：body 带当前填的 kind / baseUrl / apiKey，
  // apiKey 为空但传了 providerId 时，退回用库里已加密保存的 Key
  app.post('/models', async (req) => {
    const input = providerModelsInputSchema.parse(req.body);
    let apiKey = cleanKey(input.apiKey ?? '');
    if (!apiKey && input.providerId) {
      const stored = getProviderConfig(input.providerId);
      if (!stored) throw new HttpError(404, '模型服务不存在');
      apiKey = stored.apiKey;
    }
    const models = await listProviderModels({
      kind: input.kind,
      baseUrl: input.baseUrl,
      apiKey,
      model: '',
    });
    return { models };
  });

  app.patch('/:id', async (req) => {
    const { id } = req.params as { id: string };
    const patch = providerPatchSchema.parse(req.body);
    const next =
      patch.apiKey === undefined ? patch : { ...patch, apiKey: cleanKey(patch.apiKey) };
    const provider = updateProvider(id, next);
    if (!provider) throw new HttpError(404, '模型服务不存在');
    return { provider };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deleteProvider(id)) throw new HttpError(404, '模型服务不存在');
    return reply.code(204).send();
  });
};

export default providerRoutes;
