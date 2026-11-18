import { useState } from 'react';
import { KeyRound, Loader2, RefreshCw, Server, Sparkles, X } from 'lucide-react';
import type { ProviderInput, ProviderKind, ProviderPatch, ProviderPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

interface Preset {
  label: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
}

const PRESETS: Preset[] = [
  {
    label: 'DeepSeek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  {
    label: 'Gemini',
    name: 'Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
  {
    label: '硅基流动',
    name: '硅基流动',
    kind: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    label: 'OpenRouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
  },
];

const KIND_LABEL: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  gemini: 'Gemini 原生',
  custom: '自定义',
};

interface ProviderFormProps {
  provider: ProviderPublic | null;
  onCancel: () => void;
  onSaved: (provider: ProviderPublic, testNow: boolean) => void;
}

export function ProviderForm({ provider, onCancel, onSaved }: ProviderFormProps) {
  const editing = Boolean(provider);
  const [name, setName] = useState(provider?.name ?? '');
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'openai');
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? 'https://api.deepseek.com');
  const [model, setModel] = useState(provider?.model ?? 'deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelNote, setModelNote] = useState('');
  const [modelFailed, setModelFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const modelListId = `provider-models-${provider?.id ?? 'new'}`;

  function applyPreset(preset: Preset) {
    if (!name.trim()) setName(preset.name);
    setKind(preset.kind);
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setModels([]);
    setModelNote('');
  }

  async function fetchModels() {
    if (fetchingModels) return;
    const trimmedBase = baseUrl.trim();
    try {
      new URL(trimmedBase);
    } catch {
      setModelFailed(true);
      setModelNote('先填写正确的 Base URL');
      return;
    }
    setFetchingModels(true);
    setModelFailed(false);
    setModelNote('');
    try {
      const result = await api.listProviderModels({
        kind,
        baseUrl: trimmedBase,
        apiKey: apiKey.trim(),
        providerId: provider?.id,
      });
      setModels(result.models);
      if (result.models.length === 0) {
        setModelFailed(true);
        setModelNote('接口没有返回可用模型，请手填模型名');
      } else {
        setModelNote(`已获取 ${result.models.length} 个模型，可从下拉选择`);
        if (!model.trim()) setModel(result.models[0]);
      }
    } catch (err) {
      setModelFailed(true);
      setModelNote(err instanceof ApiError ? err.message : '拉取失败，可继续手填');
    } finally {
      setFetchingModels(false);
    }
  }

  async function submit(event: { preventDefault: () => void }, testNow: boolean) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let saved: ProviderPublic;
      if (provider) {
        const patch: ProviderPatch = { name, kind, baseUrl, model };
        if (apiKey.trim()) patch.apiKey = apiKey.trim();
        saved = (await api.updateProvider(provider.id, patch)).provider;
      } else {
        const input: ProviderInput = {
          name,
          kind,
          baseUrl,
          model,
          apiKey: apiKey.trim(),
          enabled: true,
        };
        saved = (await api.createProvider(input)).provider;
      }
      onSaved(saved, testNow);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  const canSave = Boolean(name.trim() && baseUrl.trim() && model.trim());

  return (
    <form onSubmit={(event) => void submit(event, true)} className="card-solid animate-in mt-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium text-[var(--ink)]">
            {editing ? '编辑模型服务' : '接入模型服务'}
          </p>
          <p className="mt-1 text-[11px] text-[var(--faint)]">
            Key 只保存在服务端，加密后落库
          </p>
        </div>
        <button type="button" className="btn btn-quiet h-8 min-h-8 px-2" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            onClick={() => applyPreset(preset)}
          >
            <Sparkles size={10} />
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">名称</span>
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：DeepSeek"
            maxLength={60}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">类型</span>
          <select
            className="field"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ProviderKind);
              setModels([]);
              setModelNote('');
              setModelFailed(false);
            }}
          >
            {(Object.keys(KIND_LABEL) as ProviderKind[]).map((value) => (
              <option key={value} value={value}>
                {KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-[var(--muted)]">
            <Server size={11} />
            Base URL
          </span>
          <input
            className="field tabular"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setModels([]);
              setModelNote('');
              setModelFailed(false);
            }}
            placeholder="https://api.deepseek.com"
            spellCheck={false}
          />
          <span className="mt-1.5 block text-[10px] leading-relaxed text-[var(--faint)]">
            OpenAI 兼容服务填到 /v1 或域名根；Gemini 填到域名根。
          </span>
        </label>

        <div className="block">
          <label
            htmlFor={`${modelListId}-input`}
            className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]"
          >
            模型名
          </label>
          <input
            id={`${modelListId}-input`}
            className="field tabular"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="deepseek-chat"
            spellCheck={false}
            list={modelListId}
          />
          <datalist id={modelListId}>
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost h-9 min-h-9 px-3 text-[11px]"
              onClick={() => void fetchModels()}
              disabled={fetchingModels || busy}
              title="从接口拉取可用模型列表"
            >
              {fetchingModels ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              拉取模型列表
            </button>
            {modelNote ? (
              <span
                className={`text-[10px] leading-relaxed ${
                  modelFailed ? 'text-[var(--accent-strong)]' : 'text-[var(--faint)]'
                }`}
              >
                {modelNote}
              </span>
            ) : (
              <span className="text-[10px] leading-relaxed text-[var(--faint)]">
                也可以直接手填模型名
              </span>
            )}
          </div>

          {models.length > 0 ? (
            <div className="mt-2 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-2">
              {models.map((id) => (
                <button
                  key={id}
                  type="button"
                  title={id}
                  onClick={() => setModel(id)}
                  className={`chip max-w-full transition ${
                    model === id
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'hover:border-[var(--line-strong)]'
                  }`}
                >
                  <span className="truncate">{id}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[10px] tracking-[0.16em] text-[var(--muted)]">
            <KeyRound size={11} />
            API Key
          </span>
          <input
            className="field tabular"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={editing ? '已保存，留空则不修改' : 'sk-...（本地 Ollama 可留空）'}
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--accent-strong)]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={!canSave || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          {editing ? '保存并测试' : '接入并测试'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canSave || busy}
          onClick={(event) => void submit(event, false)}
        >
          仅保存
        </button>
      </div>
    </form>
  );
}
