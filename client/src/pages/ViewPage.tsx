import { useEffect, useMemo, useState } from 'react';
import { Maximize2, PanelLeftClose, PanelLeftOpen, PencilRuler, Search } from 'lucide-react';
import type { DisplayDoc } from '@shared/types.ts';
import { Empty } from '../components/Overlays.tsx';
import { Tree } from '../components/Tree.tsx';
import { DisplayView } from '../graphics/DisplayView.tsx';
import { api, enc } from '../lib/api.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';

export function useDisplayDoc(name: string | undefined) {
  const [doc, setDoc] = useState<DisplayDoc | null>(null);
  const [error, setError] = useState('');
  const revision = useProject((s) => s.revision);
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    api.get<DisplayDoc>(`/displays/${enc(name)}`)
      .then((d) => { if (!cancelled) { setDoc((prev) => (prev && JSON.stringify(prev) === JSON.stringify(d) ? prev : d)); setError(''); } })
      .catch((e: Error) => { if (!cancelled) { setDoc(null); setError(e.message); } });
    return () => { cancelled = true; };
  }, [name, revision]);
  return { doc, error };
}

export function ViewPage() {
  const route = useRoute();
  const displays = useProject((s) => s.displays);
  const start = useProject((s) => s.info?.startDisplay);
  const name = route.param || start || displays.names[0];
  const { doc, error } = useDisplayDoc(name);
  const canEdit = useHasRole('engineer');
  const [sidebar, setSidebar] = useState(true);
  const [filter, setFilter] = useState('');
  const queryKey = route.query.toString();
  const params = useMemo(() => Object.fromEntries(new URLSearchParams(queryKey).entries()), [queryKey]);

  return (
    <div className="page with-sidebar">
      {sidebar && (
        <aside className="sidebar">
          <div className="sidebar-head">
            <span>Displays</span>
            <button className="icon-btn" onClick={() => setSidebar(false)} title="Hide"><PanelLeftClose size={15} /></button>
          </div>
          <div className="search"><Search size={14} /><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <Tree items={displays.tree} filter={filter} selected={name} defaultDepth={3}
            onSelect={(it) => { if (!it.children) navigate('view', it.id); }} />
        </aside>
      )}
      <main className="content">
        <div className="content-head">
          {!sidebar && <button className="icon-btn" onClick={() => setSidebar(true)} title="Show displays"><PanelLeftOpen size={15} /></button>}
          <h2>{doc?.title ?? name ?? 'No display'}</h2>
          <span className="muted small">{name}</span>
          <span className="spacer" />
          {canEdit && name && <button onClick={() => navigate('design', name)}><PencilRuler size={14} /> Edit</button>}
          <button className="icon-btn" title="Full screen" onClick={() => void document.documentElement.requestFullscreen?.()}><Maximize2 size={15} /></button>
        </div>
        <div className="content-body display-body">
          {error && <Empty>{error}</Empty>}
          {!name && <Empty>No displays yet. {canEdit ? 'Create one in the Designer.' : ''}</Empty>}
          {doc && <DisplayView key={doc.name} doc={doc} params={params} />}
        </div>
      </main>
    </div>
  );
}
