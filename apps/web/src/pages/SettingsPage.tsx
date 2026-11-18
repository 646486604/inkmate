import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellOff,
  BookOpen,
  Database,
  Download,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Server,
  Sun,
  Trash2,
  Upload,
  UserRound,
  Users,
} from 'lucide-react';
import type { ProviderKind, ProviderPublic } from '@inkmate/shared';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ProviderForm } from '../components/ProviderForm';
import { disablePush, enablePush, hasPushSubscription, sendTestPush } from '../lib/push';
import {
  getFontSize,
  getThemeMode,
  setFontSize,
  setThemeMode,
  type FontSize,
  type ThemeMode,
} from '../lib/appearance';

const KIND_LABEL: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  gemini: 'Gemini 原生',
  custom: '自定义',
};

export function SettingsPage() {
  const { user, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderPublic[] | null>(null);
  const [editing, setEditing] = useState<ProviderPublic | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const [backups, setBackups] = useState<Array<{ name: string; size: number; createdAt: number }>>(
    [],
  );
  const [theme, setTheme] = useState<ThemeMode>(() => getThemeMode());
  const [fontSize, setFontSizeState] = useState<FontSize>(() => getFontSize());
  const [importing, setImporting] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePersona, setProfilePersona] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    setProfileName(user.displayName ?? '');
    setProfilePersona(user.persona ?? '');
  }, [user]);

  async function saveProfile() {
    if (profileBusy) return;
    setProfileBusy(true);
    setError('');
    setNotice('');
    try {
      await api.updateProfile({
        displayName: profileName.trim(),
        persona: profilePersona.trim(),
      });
      await refresh();
      setNotice('「我的设定」已保存');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败');
    } finally {
      setProfileBusy(false);
    }
  }

  const loadProviders = useCallback(async () => {
    try {
      const result = await api.providers();
      setProviders(result.providers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载模型服务失败');
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void api
      .backupList()
      .then((result) => setBackups(result.backups))
      .catch(() => undefined);
    void hasPushSubscription()
      .then((subscribed) => setPushOn(subscribed))
      .catch(() => undefined);
  }, [loadProviders]);

  function handleSaved() {
    setEditing(undefined);
    setError('');
    void loadProviders();
  }

  async function removeProvider(provider: ProviderPublic) {
    const ok = window.confirm(`删除「${provider.name}」？已保存的 Key 也会一起删除。`);
    if (!ok) return;
    setBusyId(provider.id);
    try {
      await api.deleteProvider(provider.id);
      if (editing?.id === provider.id) setEditing(undefined);
      await loadProviders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    setError('');
    setNotice('');
    try {
      if (pushOn) {
        setNotice(await disablePush());
        setPushOn(false);
      } else {
        setNotice(await enablePush());
        setPushOn(true);
      }
      setPushPermission(Notification.permission);
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知设置失败');
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    if (pushBusy) return;
    setPushBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await sendTestPush());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '测试通知失败');
    } finally {
      setPushBusy(false);
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = '';
    if (!file) return;
    const ok = window.confirm('导入会覆盖当前数据库和媒体文件，确定继续？');
    if (!ok) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.importBackup(form);
      setNotice(`导入完成：${result.media} 个媒体文件。请重启服务并重新登录，让加密 Key 与通知配置生效。`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="animate-in space-y-5 pb-2">
      <section>
        <p className="text-[12px] text-[var(--muted)]">你好，{user?.displayName || '我'}</p>
        <h2 className="mt-1 font-display text-[29px] leading-tight">你的空间</h2>
      </section>

      {error ? (
        <div className="card-solid border-[var(--accent)] px-4 py-3 text-[12px] text-[var(--accent-strong)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="card-solid border-[var(--line)] px-4 py-3 text-[11px] leading-relaxed text-[var(--muted)]">
          {notice}
        </div>
      ) : null}

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <UserRound size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">我的设定</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
              角色眼里「你」是谁。默认全局生效；某个会话要换身份，去聊天页右上角单独设置。
            </p>
            <input
              className="field mt-3"
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              placeholder="名字，例如：林晚"
              maxLength={40}
            />
            <textarea
              className="field mt-2 min-h-[80px] resize-y"
              value={profilePersona}
              onChange={(event) => setProfilePersona(event.target.value)}
              placeholder="身份、性格、和 TA 的关系……"
              maxLength={4000}
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[9px] tabular text-[var(--faint)]">
                {profilePersona.length} / 4000
              </span>
              <button
                className="btn btn-primary h-8 min-h-8 px-3 text-[11px]"
                disabled={profileBusy}
                onClick={() => void saveProfile()}
              >
                {profileBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                保存设定
              </button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-medium">模型服务</p>
            <p className="mt-1 text-[10px] text-[var(--faint)]">聊天与后台任务都从这里走</p>
          </div>
          <button
            className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
            onClick={() => {
              setEditing(null);
              setError('');
            }}
          >
            <Plus size={13} />
            添加
          </button>
        </div>

        {providers === null ? (
          <div className="card h-24 animate-pulse" />
        ) : providers.length === 0 ? (
          <div className="card flex flex-col items-center px-5 py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--paper-strong)] text-[var(--muted)]">
              <Server size={20} strokeWidth={1.5} />
            </span>
            <p className="mt-3 text-[13px]">还没有模型服务</p>
            <p className="mt-1 max-w-[250px] text-[11px] leading-relaxed text-[var(--faint)]">
              支持 DeepSeek、Gemini、硅基流动、OpenRouter、Ollama 和任意 OpenAI 兼容接口。
            </p>
            <button className="btn btn-accent mt-4" onClick={() => setEditing(null)}>
              <Plus size={14} />
              接入第一个
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((provider) => {
              const isBusy = busyId === provider.id;
              return (
                <div key={provider.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[13px] font-medium text-[var(--accent)]">
                      {provider.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[13px] font-medium">{provider.name}</p>
                        <span className="chip shrink-0">{KIND_LABEL[provider.kind]}</span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
                        {provider.model}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-[var(--faint)]">
                        <KeyRound size={10} />
                        <span className="tabular">{provider.maskedKey || '未设置 Key'}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="btn btn-quiet h-8 min-h-8 px-2"
                        title="编辑"
                        onClick={() => setEditing(provider)}
                        disabled={isBusy}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-quiet h-8 min-h-8 px-2 text-[var(--faint)] hover:text-[var(--accent)]"
                        title="删除"
                        onClick={() => void removeProvider(provider)}
                        disabled={isBusy}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
                      onClick={() => setEditing(provider)}
                      disabled={isBusy}
                    >
                      编辑服务
                    </button>
                    {provider.enabled ? (
                      <span className="flex items-center gap-1 text-[10px] text-[var(--faint)]">
                        <span className="badge-dot" />
                        已启用
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {editing !== undefined ? (
          <ProviderForm
            key={editing?.id ?? 'new'}
            provider={editing}
            onCancel={() => setEditing(undefined)}
            onSaved={handleSaved}
          />
        ) : null}
      </section>

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            {pushPermission === 'granted' ? <Bell size={16} /> : <BellOff size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">浏览器通知</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
              {pushPermission === 'unsupported'
                ? '当前浏览器不支持 Web Push。'
                : pushOn
                  ? '已订阅。主动消息和动态会尝试推送；手机需要 HTTPS 才能订阅。'
                  : '开启后，电脑在后台也能收到主动消息。localhost 可直接用。'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn btn-ghost h-8 min-h-8 px-3 text-[10px]"
                disabled={pushBusy || pushPermission === 'unsupported'}
                onClick={() => void togglePush()}
              >
                {pushBusy ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                {pushOn ? '关闭通知' : '开启通知'}
              </button>
              {pushOn ? (
                <button
                  className="btn btn-ghost h-8 min-h-8 px-3 text-[10px]"
                  disabled={pushBusy}
                  onClick={() => void testPush()}
                >
                  发送测试
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
            <Monitor size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">外观</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
              跟随系统，或强制浅色/深色。设置只保存在这台浏览器。
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {([
                ['system', '系统', Monitor],
                ['light', '浅色', Sun],
                ['dark', '深色', Moon],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  className={`btn h-8 min-h-8 text-[10px] ${
                    theme === value ? 'btn-primary' : 'btn-ghost'
                  }`}
                  onClick={() => {
                    setTheme(value);
                    setThemeMode(value);
                  }}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-3">
              <p className="text-[9px] text-[var(--faint)]">字号</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {([
                  ['small', '小'],
                  ['standard', '标准'],
                  ['large', '大'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    className={`btn h-8 min-h-8 text-[10px] ${
                      fontSize === value ? 'btn-primary' : 'btn-ghost'
                    }`}
                    onClick={() => {
                      setFontSizeState(value);
                      setFontSize(value);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
            <Database size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">备份与恢复</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--faint)]">
              导出包含 SQLite、图片和本地音乐的 zip。导入会覆盖当前数据；每天自动保留一份数据库快照。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn btn-ghost h-8 min-h-8 px-3 text-[10px]" href="/api/backup/export">
                <Download size={12} />
                导出备份
              </a>
              <button
                className="btn btn-ghost h-8 min-h-8 px-3 text-[10px]"
                disabled={importing}
                onClick={() => backupInput.current?.click()}
              >
                {importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                导入备份
              </button>
              <input
                ref={backupInput}
                className="hidden"
                type="file"
                accept=".zip,application/zip"
                onChange={importBackup}
              />
            </div>
            {backups.length > 0 ? (
              <p className="mt-2 text-[9px] text-[var(--faint)]">
                最近自动备份：{backups[0]?.name}（
                {Math.max(1, Math.round((backups[0]?.size ?? 0) / 1024))} KB）
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Users size={16} />
          </span>
          <div>
            <p className="text-[13px] font-medium">角色</p>
            <p className="mt-0.5 text-[10px] text-[var(--faint)]">人设、开场白、模型与记忆轮数</p>
          </div>
        </div>
        <button
          className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
          onClick={() => navigate('/characters')}
        >
          管理
        </button>
      </section>

      <section className="card flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--paper-strong)] text-[var(--accent)]">
            <BookOpen size={16} />
          </span>
          <div>
            <p className="text-[13px] font-medium">世界书</p>
            <p className="mt-0.5 text-[10px] text-[var(--faint)]">背景、关系、规则，按角色注入</p>
          </div>
        </div>
        <button
          className="btn btn-ghost h-8 min-h-8 px-3 text-[11px]"
          onClick={() => navigate('/world-books')}
        >
          管理
        </button>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[var(--seal-bg)] text-[var(--seal-fg)]">
            <span className="font-display text-lg">墨</span>
          </div>
          <div>
            <p className="text-[13px] font-medium">墨伴 InkMate</p>
            <p className="mt-0.5 text-[10px] text-[var(--faint)]">v0.1.0 · 本地自用</p>
          </div>
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-[var(--muted)]">
          数据保存在本机 data/，API Key 使用 AES-256-GCM 加密。聊天、主动消息、动态、一起听都已接入。
        </p>
        <div className="hairline my-4" />
        <div className="flex items-center justify-between text-[10px] text-[var(--faint)]">
          <span>单用户 · 本地部署</span>
          <span className="tabular">M6</span>
        </div>
      </section>

      <button className="btn btn-ghost w-full text-[var(--muted)]" onClick={() => void logout()}>
        <LogOut size={15} />
        退出登录
      </button>
    </div>
  );
}
