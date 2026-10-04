import { useSyncExternalStore } from 'react';

/** Tiny hash router: #/page/rest/of/path?query */
export interface Route {
  page: string;
  param: string;
  query: URLSearchParams;
}

function parse(): Route {
  const hash = decodeURI(window.location.hash.replace(/^#\/?/, ''));
  const [path, qs] = hash.split('?');
  const [page, ...rest] = path.split('/');
  return { page: page || '', param: rest.join('/'), query: new URLSearchParams(qs ?? '') };
}

let current = parse();
const listeners = new Set<() => void>();
window.addEventListener('hashchange', () => {
  current = parse();
  listeners.forEach((l) => l());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
  );
}

export function navigate(page: string, param = '', query?: Record<string, string>): void {
  const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  window.location.hash = `/${page}${param ? `/${encodeURI(param)}` : ''}${qs}`;
}
