import { useEffect, useState } from 'react';
import { GitCompare, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Modal } from '../components/Overlays.tsx';
import { CodeEditor, DiffEditor } from '../editor/LazyMonaco.tsx';
import { api, ApiError } from '../lib/api.ts';
import { fmtDateTime } from '../lib/format.ts';
import { useProject } from '../stores/project.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

/** project.yaml editor with validation, hot reload and revision history (diff / restore). */
export function ConfigPage() {
  const revision = useProject((s) => s.revision);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [revisions, setRevisions] = useState<{ id: string; ts: number; size: number }[]>([]);
  const [diff, setDiff] = useState<{ id: string; text: string } | null>(null);

  const load = () => {
    api.get<string>('/project/yaml').then((t) => { setText(t); setDirty(false); setIssues([]); }).catch(errorToast);
    api.get<typeof revisions>('/project/revisions').then(setRevisions).catch(() => undefined);
  };
  useEffect(() => { if (!dirty) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [revision]);

  const save = async () => {
    try {
      await api.put('/project/yaml', text);
      setDirty(false);
      setIssues([]);
      toast('project.yaml saved, validated and hot-reloaded', 'success');
      load();
    } catch (err) {
      if (err instanceof ApiError && err.issues) setIssues(err.issues);
      else setIssues([(err as Error).message]);
    }
  };

  const restore = async (id: string) => {
    if (!(await useUi.getState().confirm(`Restore revision ${id}? The current file is backed up first.`))) return;
    try {
      const old = await api.get<string>(`/project/revisions/${encodeURIComponent(id)}`);
      await api.put('/project/yaml', old);
      setDiff(null);
      toast('Revision restored', 'success');
      load();
    } catch (err) { errorToast(err); }
  };

  return (
    <div className="page with-sidebar-right">
      <main className="content">
        <div className="content-head">
          <h2>Project configuration</h2>
          <span className="muted small">project.yaml {dirty ? '• modified' : ''}</span>
          <span className="spacer" />
          <button onClick={() => void api.post('/project/reload').then(() => toast('Reloaded from disk', 'success')).catch(errorToast)}><RefreshCw size={14} /> Reload from disk</button>
          <button disabled={!dirty} onClick={load}><RotateCcw size={14} /> Revert</button>
          <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={14} /> Validate & apply</button>
        </div>
        {issues.length > 0 && <div className="issues">{issues.map((i) => <div key={i}>⚠ {i}</div>)}</div>}
        <div className="content-body">
          <CodeEditor value={text} onChange={(v) => { setText(v); setDirty(true); }} language="yaml" path="project.yaml" onSave={() => void save()} />
        </div>
      </main>
      <aside className="sidebar right">
        <div className="sidebar-head"><span>Revisions</span></div>
        <div className="sidebar-scroll">
          {revisions.map((r) => (
            <div key={r.id} className="revision-row">
              <div>{fmtDateTime(r.ts)}</div>
              <div className="muted small mono">{r.id.replace(/^project-/, '').replace(/\.yaml$/, '')}</div>
              <button className="small" onClick={() => void api.get<string>(`/project/revisions/${encodeURIComponent(r.id)}`).then((t) => setDiff({ id: r.id, text: t }))}><GitCompare size={13} /> Diff</button>
            </div>
          ))}
          {!revisions.length && <div className="tree-empty">No revisions yet — every save creates one.</div>}
        </div>
      </aside>
      {diff && (
        <Modal title={`Revision ${diff.id} ↔ current`} onClose={() => setDiff(null)} width="min(1300px, 96vw)"
          footer={<><span className="spacer" /><button onClick={() => setDiff(null)}>Close</button><button className="danger" onClick={() => void restore(diff.id)}>Restore this revision</button></>}>
          <div style={{ height: '65vh' }}><DiffEditor original={diff.text} modified={text} /></div>
        </Modal>
      )}
    </div>
  );
}
