import { useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import type { TagInfo, TagValue } from '@shared/types.ts';
import { tagCache } from '../lib/hub.ts';
import { useProject } from '../stores/project.ts';

const noop = () => () => undefined;

/** Live value of one tag (re-renders on every change). */
export function useTag(path: string | undefined): TagValue | undefined {
  return useSyncExternalStore(
    useMemo(() => (path ? (cb: () => void) => tagCache.subscribe(path, cb) : noop), [path]),
    () => (path ? tagCache.get(path) : undefined),
  );
}

/**
 * Subscribe to many tags; re-renders at most once per animation frame.
 * Returns a getter reading the cache.
 */
export function useTagValues(paths: string[]): (path: string) => TagValue | undefined {
  const key = [...new Set(paths)].sort().join('\n');
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!key) return;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; bump(); });
    };
    const unsubs = key.split('\n').map((p) => tagCache.subscribe(p, schedule));
    return () => {
      cancelAnimationFrame(frame);
      unsubs.forEach((u) => u());
    };
  }, [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (p: string) => tagCache.get(p), [version, key]);
}

export function useTagInfo(path: string | undefined): TagInfo | undefined {
  return useProject((s) => (path ? s.tags.get(path) : undefined));
}
