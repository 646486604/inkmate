import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser } from '@inkmate/shared';
import { api } from './api';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api.me();
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 任意请求 401（会话没了/ cookie 没带上）就回到登录页，
  // 否则会停在各页面里反复报「未登录」
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('inkmate:unauthorized', onUnauthorized);
    return () => window.removeEventListener('inkmate:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await api.login(password);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
