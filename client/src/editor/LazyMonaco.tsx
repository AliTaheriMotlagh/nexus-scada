import { lazy, Suspense, type ComponentProps } from 'react';

/** Monaco is ~4 MB: load it only on pages that need an editor. */
const Editor = lazy(() => import('./MonacoEditor.tsx'));
const Diff = lazy(() => import('./MonacoEditor.tsx').then((m) => ({ default: m.MonacoDiff })));

export function CodeEditor(props: ComponentProps<typeof Editor>) {
  return <Suspense fallback={<div className="loading">Loading editor…</div>}><Editor {...props} /></Suspense>;
}

export function DiffEditor(props: ComponentProps<typeof Diff>) {
  return <Suspense fallback={<div className="loading">Loading editor…</div>}><Diff {...props} /></Suspense>;
}
