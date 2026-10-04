import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface FaceplateWindow {
  id: string;
  path: string;
  display?: string;
  params?: Record<string, string>;
}

interface Dialog {
  kind: 'confirm' | 'prompt';
  message: string;
  defaultValue?: string;
  resolve: (v: string | boolean | null) => void;
}

interface UiState {
  faceplates: FaceplateWindow[];
  toasts: { id: number; kind: ToastKind; message: string }[];
  dialog: Dialog | null;
  theme: 'dark' | 'light';
  /** Which sidebar is open as a drawer on small screens */
  drawer: 'left' | 'right' | null;
  setDrawer(d: 'left' | 'right' | null): void;
  openFaceplate(path: string, display?: string, params?: Record<string, string>): void;
  closeFaceplate(id: string): void;
  closeAllFaceplates(): void;
  toast(message: string, kind?: ToastKind): void;
  dismissToast(id: number): void;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;
  closeDialog(value: string | boolean | null): void;
  toggleTheme(): void;
}

let toastId = 0;
const initialTheme = (() => {
  try {
    return (localStorage.getItem('nexus.theme') as 'dark' | 'light') ?? 'dark';
  } catch {
    return 'dark';
  }
})();
document.documentElement.dataset.theme = initialTheme;

export const useUi = create<UiState>((set, get) => ({
  faceplates: [],
  toasts: [],
  dialog: null,
  theme: initialTheme,
  drawer: null,
  setDrawer: (drawer) => set({ drawer }),
  openFaceplate(path, display, params) {
    const existing = get().faceplates.find((f) => f.path === path && f.display === display);
    if (existing) return;
    const fp: FaceplateWindow = { id: `${path}|${display ?? ''}|${Date.now()}`, path, display, params: { path, ...params } };
    set({ faceplates: [...get().faceplates.slice(-4), fp] });
  },
  closeFaceplate: (id) => set({ faceplates: get().faceplates.filter((f) => f.id !== id) }),
  closeAllFaceplates: () => set({ faceplates: [] }),
  toast(message, kind = 'info') {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-5), { id, kind, message }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  confirm: (message) => new Promise<boolean>((resolve) => set({ dialog: { kind: 'confirm', message, resolve: (v) => resolve(v === true) } })),
  prompt: (message, defaultValue = '') => new Promise<string | null>((resolve) => set({ dialog: { kind: 'prompt', message, defaultValue, resolve: (v) => resolve(typeof v === 'string' ? v : null) } })),
  closeDialog(value) {
    get().dialog?.resolve(value);
    set({ dialog: null });
  },
  toggleTheme() {
    const theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nexus.theme', theme); } catch { /* ignore */ }
    set({ theme });
  },
}));

export const toast = (message: string, kind?: ToastKind) => useUi.getState().toast(message, kind);
export const errorToast = (err: unknown) => toast(err instanceof Error ? err.message : String(err), 'error');
