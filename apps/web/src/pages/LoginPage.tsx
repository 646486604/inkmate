import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, LockKeyhole, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      await login(password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-6 py-12">
      <div
        className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full opacity-30 blur-3xl"
        style={{ background: 'var(--accent)' }}
      />
      <div
        className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full opacity-20 blur-3xl"
        style={{ background: '#7d5b3a' }}
      />

      <div className="animate-in relative w-full max-w-[380px]">
        <div className="mb-9 text-center">
          <div className="relative mx-auto mb-6 grid h-[84px] w-[84px] place-items-center rounded-[28px] bg-[var(--seal-bg)] shadow-[0_20px_50px_rgba(40,26,18,0.28)]">
            <span className="font-display text-[42px] leading-none text-[var(--seal-fg)]">墨</span>
            <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--accent)] text-white shadow">
              <Sparkles size={12} />
            </span>
          </div>
          <h1 className="font-display text-[34px] leading-none tracking-[0.22em] text-[var(--ink)]">
            墨伴
          </h1>
          <p className="mt-3 text-[10px] uppercase tracking-[0.42em] text-[var(--faint)]">
            InkMate
          </p>
          <p className="mt-4 text-[13px] text-[var(--muted)]">只属于你的 AI 陪伴</p>
        </div>

        <form onSubmit={onSubmit} className="card p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-[var(--ink)]">进入你的空间</p>
              <p className="mt-1 text-[11px] text-[var(--faint)]">单用户密码登录</p>
            </div>
            <span className="chip">
              <span className="badge-dot" />
              本地
            </span>
          </div>

          <label className="block">
            <span className="mb-2 block text-[11px] tracking-[0.16em] text-[var(--muted)]">
              密码
            </span>
            <div className="relative">
              <LockKeyhole
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--faint)]"
              />
              <input
                className="field pl-10"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入访问密码"
                autoComplete="current-password"
                autoFocus
              />
            </div>
          </label>

          {error ? (
            <p className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--accent-strong)]">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn btn-primary mt-5 w-full"
            disabled={!password || busy}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                正在进入
              </>
            ) : (
              <>
                进入
                <ArrowRight size={16} />
              </>
            )}
          </button>

          <p className="mt-5 text-center text-[10px] leading-relaxed text-[var(--faint)]">
            初始密码由 ADMIN_PASSWORD 设置
            <br />
            数据与 API Key 都留在本机
          </p>
        </form>

        <p className="mt-6 text-center text-[10px] tracking-[0.08em] text-[var(--faint)]">
          M0 · 单用户 · 自部署
        </p>
      </div>
    </div>
  );
}
