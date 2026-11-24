import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, loadStoredState, onForcedLogout, setSession } from '@/lib/api';
import type { User } from '@/lib/types';

interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface AuthState {
  ready: boolean;
  user: User | null;
  login: (login: string, password: string) => Promise<void>;
  register: (data: { username: string; displayName: string; password: string; countryCode?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<User | null>;
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const me = await api.get<User>('/api/me');
      setUser(me);
      return me;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { hasSession } = await loadStoredState();
      if (hasSession) await refreshMe();
      setReady(true);
    })();
    return onForcedLogout(() => setUser(null));
  }, [refreshMe]);

  const startSession = useCallback(async (r: SessionResponse) => {
    await setSession({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setUser(r.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      setUser,
      refreshMe,
      login: async (login, password) => {
        await startSession(await api.post<SessionResponse>('/api/auth/login', { login, password }));
      },
      register: async (data) => {
        await startSession(await api.post<SessionResponse>('/api/auth/register', data));
      },
      logout: async () => {
        await setSession(null);
        setUser(null);
      },
    }),
    [ready, user, refreshMe, startSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
