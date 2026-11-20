import { useRef, useState, type ChangeEvent } from 'react';
import { Loader2, RefreshCw, Sparkles, Upload, X } from 'lucide-react';
import type {
  CharacterInput,
  CharacterPatch,
  CharacterPublic,
  Initiative,
  ProviderPublic,
  WorldBookPublic,
} from '@inkmate/shared';
import { api, ApiError } from '../lib/api';

interface CharacterFormProps {
  character: CharacterPublic | null;
  providers: ProviderPublic[];
  worldBooks: WorldBookPublic[];
  onCancel: () => void;
  onSaved: (character: CharacterPublic) => void;
}

const COLORS = ['#b4472f', '#8a6a4a', '#4f6b5d', '#5b5b8a', '#a3546a', '#3f6a7a'];

const DEFAULT_INITIATIVE: Initiative = {
  enabled: false,
  level: 'normal',
  dailyCap: 3,
  minGapMinutes: 90,
  quietStart: '23:30',
  quietEnd: '08:00',
  testMode: false,
  allowMoments: false,
  momentsPerDay: 1,
};

export function CharacterForm({
  character,
  providers,
  worldBooks,
  onCancel,
  onSaved,
}: CharacterFormProps) {
  const editing = Boolean(character);
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const [name, setName] = useState(character?.name ?? '');
  const [nickname, setNickname] = useState(character?.nickname ?? '');
  const [avatar, setAvatar] = useState(character?.avatar ?? '');
  const [persona, setPersona] = useState(character?.persona ?? '');
  const [greeting, setGreeting] = useState(character?.greeting ?? '');
  const [socialCircle, setSocialCircle] = useState(character?.socialCircle ?? '');
  const [color, setColor] = useState(character?.color ?? '#b4472f');
  const [providerId, setProviderId] = useState(character?.providerId ?? '');
  const [model, setModel] = useState(character?.model ?? '');
  const [memoryLimit, setMemoryLimit] = useState(character?.memoryLimit ?? 40);
  const [worldBookIds, setWorldBookIds] = useState<string[]>(character?.worldBookIds ?? []);
  const [initiative, setInitiative] = useState<Initiative>(
    character?.initiative ?? DEFAULT_INITIATIVE,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelNote, setModelNote] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  async function handleAvatarFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    setAvatarUploading(true);
    setError('');
    try {
      const result = await api.upload(file);
      setAvatar(result.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  }

  const selectedProvider =
    enabledProviders.find((item) => item.id === providerId) ?? enabledProviders[0];
  const modelListId = `character-models-${character?.id ?? 'new'}`;

  async function fetchModels() {
    if (!selectedProvider || fetchingModels) return;
    setFetchingModels(true);
    setModelNote('');
    try {
      const result = await api.listProviderModels({
        kind: selectedProvider.kind,
        baseUrl: selectedProvider.baseUrl,
        providerId: selectedProvider.id,
      });
      setModelOptions(result.models);
      setModelNote(
        result.models.length > 0
          ? `已获取 ${result.models.length} 个模型`
          : '接口没有返回可用模型，可手填',
      );
    } catch (err) {
      setModelNote(err instanceof ApiError ? err.message : '拉取失败，可手填');
    } finally {
      setFetchingModels(false);
    }
  }

  function toggleBook(id: string) {
    setWorldBookIds((current) =>
      current.includes(id) ? current.filter((bookId) => bookId !== id) : [...current, id],
    );
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const base: CharacterInput = {
        name,
        nickname,
        avatar,
        persona,
        greeting,
        socialCircle,
        color,
        providerId: providerId || null,
        model,
        memoryLimit,
        worldBookIds,
        initiative,
      };
      const saved = character
        ? (
            await api.updateCharacter(character.id, {
              ...base,
              providerId: providerId || null,
            } satisfies CharacterPatch)
          ).character
        : (await api.createCharacter(base)).character;
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-solid animate-in mt-4 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium">{editing ? '编辑角色' : '创建角色'}</p>
          <p className="mt-1 text-[11px] text-[var(--faint)]">
            人设会进入每次对话的提示词
          </p>
        </div>
        <button className="btn btn-quiet h-8 min-h-8 px-2" onClick={onCancel}>
          <X size={16} />
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">姓名</span>
            <input
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="角色名字"
              maxLength={60}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">昵称</span>
            <input
              className="field"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="你想怎么叫 TA"
              maxLength={60}
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
            人设
          </span>
          <textarea
            className="field min-h-[120px] resize-y"
            value={persona}
            onChange={(event) => setPersona(event.target.value)}
            placeholder="TA 是谁、怎么说话、在意什么、和我的关系……"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
            开场白（可选）
          </span>
          <textarea
            className="field min-h-[64px] resize-y"
            value={greeting}
            onChange={(event) => setGreeting(event.target.value)}
            placeholder="第一次打开聊天时，TA 说的第一句话"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[10px] tracking-[0.16em] text-[var(--muted)]">
            社交圈（可选）
            <span className="tracking-normal text-[var(--faint)]">一行一个人</span>
          </span>
          <textarea
            className="field min-h-[84px] resize-y"
            value={socialCircle}
            onChange={(event) => setSocialCircle(event.target.value)}
            placeholder={'李雷：同事，爱开玩笑\n韩梅梅：大学同学，说话直'}
          />
          <span className="mt-1 block text-[9px] leading-relaxed text-[var(--faint)]">
            这些人会在 TA 的动态下面点赞、留言；写「名字：关系」就行，不用别的格式。
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
              模型服务
            </span>
            <select
              className="field"
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">跟随默认</option>
              {enabledProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <div className="block">
            <div className="mb-1.5 flex items-center justify-between gap-1.5">
              <label
                htmlFor={`${modelListId}-input`}
                className="text-[10px] tracking-[0.16em] text-[var(--muted)]"
              >
                覆盖模型
              </label>
              <button
                type="button"
                className="btn btn-ghost h-7 min-h-7 px-2 text-[10px]"
                onClick={() => void fetchModels()}
                disabled={!selectedProvider || fetchingModels || busy}
                title={selectedProvider ? '从该服务拉取模型列表' : '先在左侧选一个模型服务'}
              >
                {fetchingModels ? (
                  <Loader2 size={10} className="animate-spin" />
                ) : (
                  <RefreshCw size={10} />
                )}
                拉取列表
              </button>
            </div>
            <input
              id={`${modelListId}-input`}
              className="field tabular"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="留空用服务默认"
              list={modelListId}
            />
            <datalist id={modelListId}>
              {modelOptions.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            {modelNote ? (
              <span className="mt-1 block text-[9px] leading-relaxed text-[var(--faint)]">
                {modelNote}
              </span>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] tracking-[0.16em] text-[var(--muted)]">关联世界书</span>
            <span className="text-[9px] text-[var(--faint)]">在前/后注入提示词</span>
          </div>
          {worldBooks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-2 text-[10px] leading-relaxed text-[var(--faint)]">
              还没有世界书。到「世界书」页面建一本，再回来关联。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {worldBooks.map((book) => {
                const checked = worldBookIds.includes(book.id);
                return (
                  <label
                    key={book.id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] transition ${
                      checked
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                        : 'border-[var(--line)] text-[var(--muted)]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3 accent-[var(--accent)]"
                      checked={checked}
                      onChange={() => toggleBook(book.id)}
                    />
                    {book.name}
                    <span className="text-[8px] opacity-60">{book.entries.length}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--line)] p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-[11px] font-medium text-[var(--ink)]">主动消息</span>
              <span className="mt-0.5 block text-[9px] leading-relaxed text-[var(--faint)]">
                按每日日程在合适的时候先开口；会遵守免打扰和日上限
              </span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={initiative.enabled}
              onChange={(event) =>
                setInitiative({ ...initiative, enabled: event.target.checked })
              }
            />
          </label>

          {initiative.enabled ? (
            <div className="mt-3 grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-[9px] text-[var(--muted)]">频率</span>
                  <select
                    className="field h-9 min-h-9 px-2 py-1 text-[11px]"
                    value={initiative.level}
                    onChange={(event) =>
                      setInitiative({
                        ...initiative,
                        level: event.target.value as Initiative['level'],
                      })
                    }
                  >
                    <option value="low">少</option>
                    <option value="normal">正常</option>
                    <option value="high">多</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[9px] text-[var(--muted)]">每天上限</span>
                  <input
                    className="field h-9 min-h-9 py-1 text-[11px]"
                    type="number"
                    min={1}
                    max={10}
                    value={initiative.dailyCap}
                    onChange={(event) =>
                      setInitiative({ ...initiative, dailyCap: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-[9px] text-[var(--muted)]">最小间隔</span>
                  <input
                    className="field h-9 min-h-9 py-1 text-[11px]"
                    type="number"
                    min={15}
                    max={720}
                    value={initiative.minGapMinutes}
                    onChange={(event) =>
                      setInitiative({
                        ...initiative,
                        minGapMinutes: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[9px] text-[var(--muted)]">免打扰起</span>
                  <input
                    className="field h-9 min-h-9 px-2 py-1 text-[11px]"
                    type="time"
                    value={initiative.quietStart}
                    onChange={(event) =>
                      setInitiative({ ...initiative, quietStart: event.target.value })
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[9px] text-[var(--muted)]">免打扰止</span>
                  <input
                    className="field h-9 min-h-9 px-2 py-1 text-[11px]"
                    type="time"
                    value={initiative.quietEnd}
                    onChange={(event) =>
                      setInitiative({ ...initiative, quietEnd: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                  checked={initiative.testMode}
                  onChange={(event) =>
                    setInitiative({ ...initiative, testMode: event.target.checked })
                  }
                />
                测试模式（忽略免打扰、1 分钟冷却；验收后再关）
              </label>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--paper-strong)] px-3 py-2">
                <label className="flex items-center gap-2 text-[10px] text-[var(--muted)]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={initiative.allowMoments}
                    onChange={(event) =>
                      setInitiative({ ...initiative, allowMoments: event.target.checked })
                    }
                  />
                  允许发动态
                </label>
                {initiative.allowMoments ? (
                  <label className="flex items-center gap-1.5 text-[9px] text-[var(--faint)]">
                    每天
                    <input
                      className="field h-7 min-h-7 w-12 px-1 py-0 text-center text-[10px]"
                      type="number"
                      min={0}
                      max={3}
                      value={initiative.momentsPerDay}
                      onChange={(event) =>
                        setInitiative({
                          ...initiative,
                          momentsPerDay: Number(event.target.value),
                        })
                      }
                    />
                    条
                  </label>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
              记忆轮数
            </span>
            <input
              className="field tabular"
              type="number"
              min={6}
              max={200}
              value={memoryLimit}
              onChange={(event) => setMemoryLimit(Number(event.target.value))}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
              主题色
            </span>
            <div className="flex items-center gap-2">
              <input
                className="h-10 w-12 cursor-pointer rounded-lg border border-[var(--line)] bg-transparent"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
              <div className="flex gap-1">
                {COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="h-6 w-6 rounded-full border border-white/40"
                    style={{ background: value }}
                    onClick={() => setColor(value)}
                    aria-label={`选择颜色 ${value}`}
                  />
                ))}
              </div>
            </div>
          </label>
        </div>

        <div className="block">
          <span className="mb-1.5 block text-[10px] tracking-[0.16em] text-[var(--muted)]">
            头像（可选）
          </span>
          <div className="flex items-center gap-3">
            {avatar ? (
              <img src={avatar} alt="" className="h-12 w-12 shrink-0 rounded-2xl object-cover" />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[13px] font-medium text-[var(--faint)]">
                {name.trim().slice(0, 1) || '?'}
              </div>
            )}
            <input
              className="field flex-1"
              value={avatar}
              onChange={(event) => setAvatar(event.target.value)}
              placeholder="图片 URL，或点右侧上传"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn btn-ghost h-10 min-h-10 px-3 text-[11px]"
              disabled={avatarUploading}
              onClick={() => avatarFileRef.current?.click()}
            >
              {avatarUploading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Upload size={12} />
              )}
              上传
            </button>
            <input
              ref={avatarFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--accent-strong)]">
          {error}
        </p>
      ) : null}

      {enabledProviders.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--faint)]">
          还没有启用的模型服务。角色可以先创建，但聊天前需要去设置里接入模型。
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <button className="btn btn-primary flex-1" disabled={!name.trim() || busy} onClick={() => void save()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {editing ? '保存' : '创建角色'}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}
