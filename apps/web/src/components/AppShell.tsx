import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Images, MessageCircle, Music2, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useMusicPlayer } from '../lib/music-player';

const NAV = [
  { to: '/', label: '消息', icon: MessageCircle, end: true },
  { to: '/moments', label: '动态', icon: Images, end: false },
  { to: '/music', label: '一起听', icon: Music2, end: false },
  { to: '/settings', label: '我的', icon: UserRound, end: false },
] as const;

const TITLES: Record<string, string> = {
  '/': '消息',
  '/characters': '角色',
  '/world-books': '世界书',
  '/moments': '动态',
  '/music': '一起听',
  '/settings': '我的',
};

export function AppShell() {
  const { user } = useAuth();
  const { current } = useMusicPlayer();
  const location = useLocation();
  const [online, setOnline] = useState(true);
  const title = TITLES[location.pathname] ?? '墨伴';
  const messagesSection =
    location.pathname === '/' || location.pathname.startsWith('/characters');
  const settingsSection =
    location.pathname === '/settings' || location.pathname.startsWith('/world-books');
  const showMini = Boolean(current) && location.pathname !== '/music';

  // 手机后台冻结或服务卡死时，先把「在线」变「离线」，
  // 比所有页面一起转圈更容易判断是服务没响应还是页面自身的问题。
  useEffect(() => {
    let alive = true;
    const ping = () => {
      if (document.hidden) return;
      api
        .health()
        .then(() => {
          if (alive) setOnline(true);
        })
        .catch(() => {
          if (alive) setOnline(false);
        });
    };
    ping();
    const timer = window.setInterval(ping, 15_000);
    const onVisible = () => {
      if (!document.hidden) ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <div className="app-frame flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-5 pb-4 pt-[calc(env(safe-area-inset-top)+20px)]">
        <div>
          <p className="text-[9px] uppercase tracking-[0.38em] text-[var(--faint)]">InkMate</p>
          <h1 className="mt-1 font-display text-[26px] leading-none text-[var(--ink)]">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`chip ${online ? '' : 'text-[var(--accent-strong)]'}`}
            title={online ? '服务在响应' : '服务 5 秒没响应：Termux 可能被系统冻结，或进程已退出'}
          >
            <span
              className="badge-dot"
              style={{ background: online ? '#2fa463' : 'var(--accent-strong)' }}
            />
            {online ? '在线' : '离线'}
          </span>
          <div className="grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--seal-bg)] text-[13px] font-medium text-[var(--seal-fg)] shadow-sm">
            {(user?.displayName || '我').slice(0, 1)}
          </div>
        </div>
      </header>

      <main className={`flex-1 px-5 ${showMini ? 'pb-28' : 'pb-8'}`}>
        <Outlet />
      </main>

      <nav
        className="sticky bottom-0 z-20 mt-auto flex border-t border-[var(--line)] px-3"
        style={{
          background: 'var(--nav)',
          paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        }}
      >
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `nav-link${
                  (item.to === '/'
                    ? messagesSection
                    : item.to === '/settings'
                      ? settingsSection
                      : isActive)
                    ? ' active'
                    : ''
                }`
              }
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
