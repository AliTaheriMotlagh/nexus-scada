import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FilePlus2, Play, Plus, Save, Trash2, XCircle } from 'lucide-react';
import type { ScriptConfig, ScriptLogEntry, ScriptStatus, ScriptTrigger, TreeItem } from '@shared/types.ts';
import { Empty } from '../components/Overlays.tsx';
import { Tree } from '../components/Tree.tsx';
import { CodeEditor } from '../editor/LazyMonaco.tsx';
import type { EditorMarker } from '../editor/MonacoEditor.tsx';
import { api } from '../lib/api.ts';
import { fmtTime } from '../lib/format.ts';
import { runtime } from '../lib/hub.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const TEMPLATE = `// Server script — TypeScript, runs inside the runtime.
// Globals: tags, alarms, history, recipes, log, http, sleep, event, db, mqtt, notify, runScript, state
// Type "tags." to see the API; tag paths autocomplete inside the quotes.

const value: number = tags.get('Plant/Area1/Pressure');
log.info(\`Pressure is \${value.toFixed(2)} bar (trigger: \${event.type})\`);
`;

function TriggersEditor({ triggers, onChange }: { triggers: ScriptTrigger[]; onChange: (t: ScriptTrigger[]) => void }) {
  const set = (i: number, t: ScriptTrigger) => onChange(triggers.map((x, j) => (j === i ? t : x)));
  return (
    <div className="triggers">
      {triggers.map((t, i) => (
        <div key={i} className="trigger-row">
          <select value={t.type} onChange={(e) => {
            const type = e.target.value as ScriptTrigger['type'];
            set(i, type === 'interval' ? { type, ms: 1000 } : type === 'tagChange' ? { type, tags: [] } : type === 'cron' ? { type, cron: '*/5 * * * *' } : type === 'alarm' ? { type, minSeverity: 'high' } : { type } as ScriptTrigger);
          }}>
            {['startup', 'interval', 'tagChange', 'cron', 'alarm', 'manual'].map((x) => <option key={x}>{x}</option>)}
          </select>
          {t.type === 'interval' && <input type="number" value={t.ms} onChange={(e) => set(i, { ...t, ms: Number(e.target.value) })} title="milliseconds" />}
          {t.type === 'tagChange' && <input className="mono" list="nexus-tag-list" value={t.tags.join(', ')} placeholder="Plant/Area1/*, Home/Sensors/Power" onChange={(e) => set(i, { ...t, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />}
          {t.type === 'cron' && <input className="mono" value={t.cron} title="cron, @hourly, @every 30s, @sunset-15m" onChange={(e) => set(i, { ...t, cron: e.target.value })} />}
          {t.type === 'alarm' && <select value={t.minSeverity ?? 'info'} onChange={(e) => set(i, { ...t, minSeverity: e.target.value as never })}>{['critical', 'high', 'medium', 'low', 'info'].map((s) => <option key={s}>{s}</option>)}</select>}
          <button className="icon-btn" onClick={() => onChange(triggers.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
        </div>
      ))}
      <button className="small" onClick={() => onChange([...triggers, { type: 'interval', ms: 1000 }])}><Plus size={13} /> Trigger</button>
    </div>
  );
}

function LogConsole({ filter }: { filter?: string }) {
  const [lines, setLines] = useState<ScriptLogEntry[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => runtime.watchScriptLog((e) => setLines((l) => [...l.slice(-400), e])), []);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [lines]);
  const shown = filter ? lines.filter((l) => l.script === filter) : lines;
  return (
    <div className="console">
      <div className="console-head"><span>Live log {filter ? `· ${filter}` : '(all scripts)'}</span><button className="small" onClick={() => setLines([])}>Clear</button></div>
      <div className="console-body">
        {shown.map((l, i) => <div key={i} className={`log-${l.level}`}><span className="muted">{fmtTime(l.ts)}</span> <b>[{l.script}]</b> {l.message}</div>)}
        <div ref={end} />
      </div>
    </div>
  );
}

export function ScriptsPage() {
  const route = useRoute();
  const revision = useProject((s) => s.revision);
  const [list, setList] = useState<ScriptStatus[]>([]);
  const [cfg, setCfg] = useState<ScriptConfig | null>(null);
  const [code, setCode] = useState('');
  const [dirty, setDirty] = useState(false);
  const [markers, setMarkers] = useState<EditorMarker[]>([]);
  const [check, setCheck] = useState<{ ok: boolean; error?: string } | null>(null);
  const name = route.param || null;

  const refresh = () => api.get<ScriptStatus[]>('/scripts').then(setList).catch(errorToast);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [revision]);

  useEffect(() => {
    if (!name) return;
    api.get<{ config: ScriptConfig; code: string }>(`/scripts/${encodeURIComponent(name)}`)
      .then((r) => { setCfg(r.config); setCode(r.code); setDirty(false); setMarkers([]); setCheck(null); })
      .catch(errorToast);
  }, [name]);

  // server-side compile check (same compiler as the runtime), debounced
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      api.post<{ ok: boolean; error?: string; line?: number }>('/scripts/check', { code }).then((r) => {
        setCheck(r);
        setMarkers(r.ok || !r.line ? [] : [{ line: r.line, message: r.error ?? 'error' }]);
      }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  }, [code, dirty]);

  const save = async () => {
    if (!cfg) return;
    try {
      await api.put(`/scripts/${encodeURIComponent(cfg.name)}`, { code, config: cfg });
      setDirty(false);
      toast(`Script ${cfg.name} saved & reloaded`, 'success');
      void refresh();
    } catch (err) { errorToast(err); }
  };

  const create = async () => {
    const n = await useUi.getState().prompt('New server script name:', 'MyScript');
    if (!n || !/^[\w-]+$/.test(n)) return n && toast('Use letters, digits, _ or -', 'error');
    try {
      await api.put(`/scripts/${encodeURIComponent(n)}`, { code: TEMPLATE, config: { name: n, file: `${n}.ts`, triggers: [{ type: 'manual' }], enabled: true } });
      await refresh();
      navigate('scripts', n);
    } catch (err) { errorToast(err); }
  };

  const remove = async () => {
    if (!cfg || !(await useUi.getState().confirm(`Remove script "${cfg.name}" from the project? (file is kept)`))) return;
    try {
      await api.del(`/scripts/${encodeURIComponent(cfg.name)}`);
      setCfg(null);
      navigate('scripts');
      void refresh();
    } catch (err) { errorToast(err); }
  };

  const run = async () => {
    if (!cfg) return;
    try {
      if (dirty) await save();
      await api.post(`/scripts/${encodeURIComponent(cfg.name)}/run`, {});
      toast(`${cfg.name} executed`, 'success');
    } catch (err) { errorToast(err); }
  };

  const items: TreeItem[] = [{
    id: '__server', name: 'Server scripts', kind: 'folder',
    children: list.map((s) => ({ id: s.name, name: s.name, kind: 'script', description: s.description, meta: { errors: s.errors } })),
  }];
  const status = list.find((s) => s.name === name);

  return (
    <div className="page with-sidebar">
      <aside className="sidebar">
        <div className="sidebar-head"><span>Scripts</span><button className="icon-btn" title="New script" onClick={() => void create()}><FilePlus2 size={15} /></button></div>
        <div className="sidebar-scroll">
          <Tree items={items} selected={name} defaultDepth={2} onSelect={(it) => { if (!it.children) navigate('scripts', it.id); }}
            renderExtra={(it) => {
              const s = list.find((x) => x.name === it.id);
              if (!s) return null;
              return <span className={`dot ${!s.enabled ? 'state-disabled' : s.lastError ? 'state-error' : 'state-connected'}`} title={s.lastError ?? `${s.runs} runs`} />;
            }} />
          <div className="hint">Page scripts (element events, display open/timer) are edited in the Designer — same TypeScript API.</div>
        </div>
      </aside>
      <main className="content">
        {!cfg ? <Empty>Select or create a server script.</Empty> : (
          <>
            <div className="content-head">
              <h2>{cfg.name}</h2>
              {status && <span className="muted small">{status.runs} runs · {status.errors} errors · last {fmtTime(status.lastRun)} ({status.lastDurationMs ?? 0} ms)</span>}
              {check && (check.ok ? <span className="ok-text"><CheckCircle2 size={14} /> compiles</span> : <span className="err-text"><XCircle size={14} /> {check.error}</span>)}
              <span className="spacer" />
              <button onClick={() => void run()}><Play size={14} /> Run now</button>
              <button className="icon-btn" title="Remove" onClick={() => void remove()}><Trash2 size={15} /></button>
              <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={14} /> Save</button>
            </div>
            <div className="script-layout">
              <div className="script-editor">
                <CodeEditor value={code} onChange={(v) => { setCode(v); setDirty(true); }} language="typescript" scriptKind="server" path={`scripts/${cfg.name}`} onSave={() => void save()} markers={markers} />
              </div>
              <div className="script-side">
                <label className="row-field col">Description<input value={cfg.description ?? ''} onChange={(e) => { setCfg({ ...cfg, description: e.target.value }); setDirty(true); }} /></label>
                <label className="check"><input type="checkbox" checked={cfg.enabled !== false} onChange={(e) => { setCfg({ ...cfg, enabled: e.target.checked }); setDirty(true); }} /> Enabled</label>
                <b>Triggers</b>
                <TriggersEditor triggers={cfg.triggers ?? []} onChange={(triggers) => { setCfg({ ...cfg, triggers }); setDirty(true); }} />
                {status?.lastError && <div className="form-error">Last error: {status.lastError}</div>}
              </div>
            </div>
            <LogConsole filter={cfg.name} />
          </>
        )}
      </main>
    </div>
  );
}
