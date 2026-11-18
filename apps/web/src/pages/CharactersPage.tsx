import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  MessageCircle,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { CharacterPublic, ProviderPublic, WorldBookPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { CharacterForm } from '../components/CharacterForm';

export function CharactersPage() {
  const navigate = useNavigate();
  const [characters, setCharacters] = useState<CharacterPublic[] | null>(null);
  const [providers, setProviders] = useState<ProviderPublic[]>([]);
  const [worldBooks, setWorldBooks] = useState<WorldBookPublic[]>([]);
  const [editing, setEditing] = useState<CharacterPublic | null | undefined>(undefined);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [characterResult, providerResult, worldBookResult] = await Promise.all([
        api.characters(),
        api.providers(),
        api.worldBooks(),
      ]);
      setCharacters(characterResult.characters);
      setProviders(providerResult.providers);
      setWorldBooks(worldBookResult.worldBooks);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败');
      setCharacters([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startChat(character: CharacterPublic) {
    setBusyId(character.id);
    setError('');
    try {
      const result = await api.createChat(character.id);
      navigate(`/chats/${result.chat.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建会话失败');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(character: CharacterPublic) {
    if (!window.confirm(`删除角色「${character.name}」？关联的聊天记录也会删除。`)) return;
    setBusyId(character.id);
    try {
      await api.deleteCharacter(character.id);
      if (editing?.id === character.id) setEditing(undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  async function createGroup() {
    if (groupBusy || groupIds.length < 2 || !groupTitle.trim()) return;
    setGroupBusy(true);
    setError('');
    try {
      const result = await api.createGroupChat(groupTitle.trim(), groupIds);
      navigate(`/chats/${result.chat.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建群聊失败');
    } finally {
      setGroupBusy(false);
    }
  }

  function toggleGroupMember(id: string) {
    setGroupIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= 6
          ? current
          : [...current, id],
    );
  }

  const providerName = (id: string | null) =>
    providers.find((provider) => provider.id === id)?.name ?? '默认服务';

  return (
    <div className="animate-in space-y-5 pb-2">
      <div className="flex items-center justify-between">
        <button className="btn btn-quiet h-8 min-h-8 px-1 text-[11px]" onClick={() => navigate('/')}>
          <ArrowLeft size={14} />
          消息
        </button>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-quiet h-8 min-h-8 px-2 text-[11px]"
            onClick={() => {
              setGroupOpen((open) => !open);
              setError('');
            }}
          >
            <Users size={13} />
            群聊
          </button>
          <button
            className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
            onClick={() => {
              setEditing(null);
              setError('');
            }}
          >
            <Plus size={13} />
            新建角色
          </button>
        </div>
      </div>

      <section>
        <p className="text-[12px] text-[var(--muted)]">角色</p>
        <h2 className="mt-1 font-display text-[29px] leading-tight">想和谁说话？</h2>
      </section>

      {error ? (
        <div className="card-solid px-4 py-3 text-[12px] text-[var(--accent-strong)]">{error}</div>
      ) : null}

      {groupOpen ? (
        <div className="card-solid animate-in p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium">创建群聊</p>
              <p className="mt-1 text-[10px] text-[var(--faint)]">选 2–6 个角色，他们会轮流接话</p>
            </div>
            <button
              className="btn btn-quiet h-8 min-h-8 px-2"
              onClick={() => setGroupOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <input
            className="field mt-4"
            value={groupTitle}
            onChange={(event) => setGroupTitle(event.target.value)}
            placeholder="群聊名称，例如：晚自习后"
            maxLength={60}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(characters ?? []).map((character) => {
              const checked = groupIds.includes(character.id);
              return (
                <label
                  key={character.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[11px] transition ${
                    checked
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]'
                      : 'border-[var(--line)] text-[var(--muted)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    checked={checked}
                    onChange={() => toggleGroupMember(character.id)}
                  />
                  <span className="truncate">{character.nickname || character.name}</span>
                </label>
              );
            })}
          </div>
          {(characters?.length ?? 0) < 2 ? (
            <p className="mt-2 text-[10px] text-[var(--faint)]">至少先创建两个角色。</p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button
              className="btn btn-primary flex-1"
              disabled={groupBusy || groupIds.length < 2 || !groupTitle.trim()}
              onClick={() => void createGroup()}
            >
              {groupBusy ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              创建群聊（{groupIds.length}）
            </button>
            <button className="btn btn-ghost" onClick={() => setGroupOpen(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}

      {characters === null ? (
        <div className="card h-28 animate-pulse" />
      ) : characters.length === 0 ? (
        <div className="card flex flex-col items-center px-5 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--muted)]">
            <UserRound size={24} strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-[13px]">还没有角色</p>
          <p className="mt-1 max-w-[250px] text-[11px] leading-relaxed text-[var(--faint)]">
            给 TA 一个名字、一段人设，就可以开始聊天。模型会按你写的人设说话。
          </p>
          <button className="btn btn-accent mt-4" onClick={() => setEditing(null)}>
            <Sparkles size={14} />
            创建第一个角色
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {characters.map((character) => {
            const busy = busyId === character.id;
            const avatar = character.avatar?.trim();
            return (
              <div key={character.id} className="card p-4">
                <div className="flex items-start gap-3">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={character.name}
                      className="h-12 w-12 shrink-0 rounded-2xl object-cover"
                    />
                  ) : (
                    <div
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[17px] font-medium text-white"
                      style={{ background: character.color }}
                    >
                      {character.name.slice(0, 1)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-[14px] font-medium">{character.name}</p>
                      {character.nickname ? (
                        <span className="truncate text-[11px] text-[var(--faint)]">
                          {character.nickname}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--muted)]">
                      {character.persona.trim() || '还没有写人设'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--faint)]">
                      <span className="chip">{providerName(character.providerId)}</span>
                      <span className="chip">{character.memoryLimit} 轮记忆</span>
                      <span className="chip">
                        {character.initiative.enabled ? '主动 开' : '主动 关'}
                        {character.initiative.testMode ? ' · 测试' : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    className="btn btn-primary h-8 min-h-8 flex-1 px-3 text-[11px]"
                    disabled={busy}
                    onClick={() => void startChat(character)}
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <MessageCircle size={12} />
                    )}
                    开始聊天
                  </button>
                  <button
                    className="btn btn-quiet h-8 min-h-8 px-2"
                    title="编辑"
                    onClick={() => setEditing(character)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="btn btn-quiet h-8 min-h-8 px-2 text-[var(--faint)] hover:text-[var(--accent)]"
                    title="删除"
                    disabled={busy}
                    onClick={() => void remove(character)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing !== undefined ? (
        <CharacterForm
          key={editing?.id ?? 'new'}
          character={editing}
          providers={providers}
          worldBooks={worldBooks}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
