import type { CharacterPublic } from '@inkmate/shared';
import { getProviderConfig, listProviders } from '../db/providers.js';
import { HttpError } from '../lib/http-error.js';
import type { ProviderConfig } from './provider.js';

export function resolveProviderForCharacter(character: CharacterPublic): ProviderConfig {
  let providerId = character.providerId;
  if (!providerId) {
    const first = listProviders().find((provider) => provider.enabled);
    if (!first) throw new HttpError(400, '还没有可用的模型服务，请先在设置里接入');
    providerId = first.id;
  }

  const config = getProviderConfig(providerId);
  if (!config) throw new HttpError(400, '角色绑定的模型服务不存在，请重新选择');
  if (!config.provider.enabled) throw new HttpError(400, '该模型服务已停用');

  return {
    kind: config.provider.kind,
    baseUrl: config.provider.baseUrl,
    apiKey: config.apiKey,
    model: character.model.trim() || config.provider.model,
    extra: config.extra,
  };
}
