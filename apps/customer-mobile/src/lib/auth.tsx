import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Me } from '@sl/shared';
import { api, setUnauthenticatedHandler } from './api';
import { tokenStore } from './token-store';

interface AuthState {
  user: Me | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(async () => {
    await tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(() => void clear());
    (async () => {
      try {
        if (await tokenStore.get()) setUser(await api.me());
      } catch {
        await clear();
      } finally {
        setReady(true);
      }
    })();
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signIn: async (email, password) => {
        const r = await api.login(email, password);
        await tokenStore.set(r.token);
        setUser(r.user);
      },
      register: async (name, email, password) => {
        const r = await api.register(name, email, password);
        await tokenStore.set(r.token);
        setUser(r.user);
      },
      signOut: async () => {
        await api.logout().catch(() => undefined);
        await clear();
      },
    }),
    [user, ready, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
