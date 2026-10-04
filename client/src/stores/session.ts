import { create } from 'zustand';
import { ROLE_RANK, type Role, type SessionUser } from '@shared/types.ts';

const TOKEN_KEY = 'nexus.token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

interface SessionState {
  token: string | null;
  /** Logged-in user; null = anonymous */
  user: SessionUser | null;
  anonymousRole: Role | null;
  loginOpen: boolean;
  setSession(token: string | null, user: SessionUser | null): void;
  setAnonymousRole(role: Role | null): void;
  openLogin(open: boolean): void;
  logout(): void;
}

export const useSession = create<SessionState>((set) => ({
  token: readToken(),
  user: null,
  anonymousRole: 'viewer',
  loginOpen: false,
  setSession(token, user) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* storage unavailable */ }
    set({ token, user });
  },
  setAnonymousRole: (role) => set({ anonymousRole: role }),
  openLogin: (open) => set({ loginOpen: open }),
  logout() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    set({ token: null, user: null });
  },
}));

/** Effective role of the current viewer. */
export function currentRole(): Role | null {
  const s = useSession.getState();
  return s.user?.role ?? s.anonymousRole;
}

export function hasRole(role: Role, actual: Role | null = currentRole()): boolean {
  return actual !== null && ROLE_RANK[actual] >= ROLE_RANK[role];
}

/** React hook: does the current user have at least `role`? */
export function useHasRole(role: Role): boolean {
  const user = useSession((s) => s.user);
  const anon = useSession((s) => s.anonymousRole);
  return hasRole(role, user?.role ?? anon);
}
