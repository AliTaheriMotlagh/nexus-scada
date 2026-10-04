import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Cpu, Folder, Plus, RotateCcw, Save, Search, Tag, Trash2 } from 'lucide-react';
import {
  ALARM_KINDS, DRIVER_TYPES, SEVERITIES,
  type AlarmDef, type DeviceNode, type DriverType, type ProjectNode, type TagNode, type TreeItem,
} from '@shared/types.ts';
import { Empty } from '../components/Overlays.tsx';
import { TrendChart } from '../components/TrendChart.tsx';
import { Sidebar } from '../components/Sidebar.tsx';
import { Tree } from '../components/Tree.tsx';
import { writeTag } from '../graphics/elements/controls.tsx';
import { useTag } from '../hooks/useTags.ts';
import { api, ApiError } from '../lib/api.ts';
import { fmtDateTime, formatValue } from '../lib/format.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const SOURCE_HINT: Record<DriverType, string> = {
  simulation: '{ "fn": "sine", "min": 0, "max": 100, "period": 60 }   fn: sine|cosine|ramp|triangle|square|toggle|random|randomWalk|counter|clock|static',
  memory: '(not used)',
  'modbus-tcp': '{ "area": "holding", "address": 0, "type": "float32", "scale": 1 }   area: holding|input|coil|discrete',
  mqtt: '{ "topic": "zigbee2mqtt/lamp", "path": "state", "writeTopic": "zigbee2mqtt/lamp/set", "writeTemplate": "{\\"state\\":\\"{{value}}\\"}", "onValue": "ON", "offValue": "OFF" }',
  rest: '{ "path": "/api/states/sensor.x", "jsonPath": "state", "write": { "method": "POST", "path": "/api/x", "body": "{\\"v\\": {{json}}}" } }',
  sql: '{ "query": "SELECT count(*) FROM alarm_events" }',
};
const SETTINGS_HINT: Record<DriverType, string> = {
  simulation: '{ "intervalMs": 500 }',
  memory: '{}',
  'modbus-tcp': '{ "host": "192.168.1.10", "port": 502, "unitId": 1, "pollMs": 1000, "wordSwap": false }',
  mqtt: '{ "url": "mqtt://localhost:1883", "username": "", "password": "" }',
  rest: '{ "baseUrl": "http://host:8123", "pollMs": 5000, "headers": { "Authorization": "Bearer …" } }',
  sql: '{ "pollMs": 5000, "file": "optional/other.db" }',
};

// ── tree helpers (paths are "A/B/C") ──
interface Located { node: ProjectNode; siblings: ProjectNode[]; index: number; device?: DeviceNode }
function locate(nodes: ProjectNode[], path: string): Located | undefined {
  const parts = path.split('/');
  let list = nodes;
  let device: DeviceNode | undefined;
  for (let i = 0; i < parts.length; i++) {
    const index = list.findIndex((n) => n.name === parts[i]);
    if (index < 0) return undefined;
    const node = list[index];
    if (i === parts.length - 1) return { node, siblings: list, index, device };
    if (node.kind === 'tag') return undefined;
    if (node.kind === 'device') device = node;
    list = (node.children ??= []);
  }
  return undefined;
}
function toTree(nodes: ProjectNode[], base = ''): TreeItem[] {
  return nodes.map((n) => {
    const id = base ? `${base}/${n.name}` : n.name;
    return n.kind === 'tag'
      ? { id, name: n.name, kind: 'tag', description: n.description, meta: { dataType: n.dataType ?? 'number' } }
      : { id, name: n.name, kind: n.kind, description: n.description, children: toTree(n.children ?? [], id), meta: n.kind === 'device' ? { driver: n.driver, enabled: n.enabled !== false } : undefined };
  });
}

function JsonField({ label, value, onChange, hint, rows = 4 }: { label: string; value: unknown; onChange: (v: unknown) => void; hint?: string; rows?: number }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)));
  const [err, setErr] = useState('');
  useEffect(() => { setText(value === undefined ? '' : JSON.stringify(value, null, 2)); }, [value]);
  return (
    <label className="row-field col">
      {label}
      <textarea className="mono" rows={rows} value={text} placeholder={hint} onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) { setErr(''); onChange(undefined); return; }
          try { onChange(JSON.parse(text)); setErr(''); } catch (e) { setErr((e as Error).message); }
        }} />
      {err && <span className="form-error">{err}</span>}
      {hint && <span className="hint mono">{hint}</span>}
    </label>
  );
}

function LivePanel({ path }: { path: string }) {
  const info = useProject((s) => s.tags.get(path));
  const tv = useTag(path);
  const [v, setV] = useState('');
  const canWrite = useHasRole(info?.writeRole ?? 'operator') && info?.writable;
  return (
    <div className="live-panel">
      <div className="live-value">{formatValue(tv?.value, info)}</div>
      <div className="muted small">quality <b className={`q-text-${tv?.quality}`}>{tv?.quality ?? '—'}</b> · {fmtDateTime(tv?.ts)}</div>
      {canWrite && (
        <div className="write-row">
          {info?.dataType === 'boolean'
            ? <><button onClick={() => void writeTag(path, true)}>Set ON</button><button onClick={() => void writeTag(path, false)}>Set OFF</button></>
            : <><input placeholder="value" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void writeTag(path, info?.dataType === 'number' ? Number(v) : v); }} />
              <button onClick={() => void writeTag(path, info?.dataType === 'number' ? Number(v) : v)}>Write</button></>}
        </div>
      )}
      {info?.history && info.dataType !== 'string' && <div style={{ height: 180 }}><TrendChart paths={[path]} minutes={15} compact /></div>}
    </div>
  );
}

function AlarmsEditor({ alarms, onChange, disabled }: { alarms: AlarmDef[]; onChange: (a: AlarmDef[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<AlarmDef>) => onChange(alarms.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className="alarm-editor">
      <table>
        <thead><tr><th>Kind</th><th>Limit</th><th>Severity</th><th>Message</th><th>Deadband</th><th>Delay s</th><th>On</th><th /></tr></thead>
        <tbody>
          {alarms.map((a, i) => (
            <tr key={i}>
              <td><select disabled={disabled} value={a.kind} onChange={(e) => set(i, { kind: e.target.value as AlarmDef['kind'] })}>{ALARM_KINDS.map((k) => <option key={k}>{k}</option>)}</select></td>
              <td><input disabled={disabled} value={a.limit === undefined ? '' : String(a.limit)} onChange={(e) => set(i, { limit: e.target.value === '' ? undefined : Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} /></td>
              <td><select disabled={disabled} value={a.severity ?? ''} onChange={(e) => set(i, { severity: (e.target.value || undefined) as AlarmDef['severity'] })}><option value="">(default)</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></td>
              <td><input disabled={disabled} value={a.message ?? ''} placeholder="{path} {value}{unit}" onChange={(e) => set(i, { message: e.target.value || undefined })} /></td>
              <td><input disabled={disabled} type="number" value={a.deadband ?? ''} onChange={(e) => set(i, { deadband: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
              <td><input disabled={disabled} type="number" value={a.delay ?? ''} onChange={(e) => set(i, { delay: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
              <td><input disabled={disabled} type="checkbox" checked={a.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked ? undefined : false })} /></td>
              <td>{!disabled && <button className="icon-btn" onClick={() => onChange(alarms.filter((_, j) => j !== i))}><Trash2 size={13} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!disabled && <button className="small" onClick={() => onChange([...alarms, { kind: 'hi', limit: 80, severity: 'high' }])}><Plus size={13} /> Add alarm</button>}
    </div>
  );
}

function TagForm({ tag, driver, onChange, readOnly }: { tag: TagNode; driver?: DriverType; onChange: (patch: Partial<TagNode>) => void; readOnly: boolean }) {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const history = typeof tag.history === 'object' ? tag.history : tag.history ? {} : undefined;
  return (
    <fieldset className="form grid2" disabled={readOnly}>
      <label>Data type<select value={tag.dataType ?? 'number'} onChange={(e) => onChange({ dataType: e.target.value as TagNode['dataType'] })}><option>number</option><option>boolean</option><option>string</option><option>json</option></select></label>
      <label>Unit<input value={tag.unit ?? ''} onChange={(e) => onChange({ unit: e.target.value || undefined })} /></label>
      <label className="span2">Description<input value={tag.description ?? ''} onChange={(e) => onChange({ description: e.target.value || undefined })} /></label>
      <label>Min<input type="number" value={tag.min ?? ''} onChange={(e) => onChange({ min: num(e.target.value) })} /></label>
      <label>Max<input type="number" value={tag.max ?? ''} onChange={(e) => onChange({ max: num(e.target.value) })} /></label>
      <label>Decimals<input type="number" value={tag.decimals ?? ''} onChange={(e) => onChange({ decimals: num(e.target.value) })} /></label>
      <label>Publish deadband<input type="number" value={tag.deadband ?? ''} onChange={(e) => onChange({ deadband: num(e.target.value) })} /></label>
      <label className="check"><input type="checkbox" checked={!!tag.writable} onChange={(e) => onChange({ writable: e.target.checked || undefined })} /> Writable</label>
      <label>Write role<select value={tag.writeRole ?? ''} onChange={(e) => onChange({ writeRole: (e.target.value || undefined) as TagNode['writeRole'] })}><option value="">operator (default)</option><option>engineer</option><option>admin</option></select></label>
      <label>Initial value<input value={tag.initial === undefined ? '' : String(tag.initial)} onChange={(e) => onChange({ initial: e.target.value === '' ? undefined : e.target.value === 'true' ? true : e.target.value === 'false' ? false : Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} /></label>
      <label className="span2" title="TypeScript expression; tag('./Sibling') for relative paths">Expression (calculated tag)
        <input className="mono" value={tag.expression ?? ''} placeholder="tag('./A') * 2 + tag('Plant/Area1/B')" onChange={(e) => onChange({ expression: e.target.value || undefined })} />
      </label>
      <div className="span2"><JsonField label={`Source / address${driver ? ` (${driver})` : ''}`} value={tag.source} onChange={(v) => onChange({ source: v as TagNode['source'] })} hint={driver ? SOURCE_HINT[driver] : 'Tags outside devices are memory tags'} /></div>
      <label className="check"><input type="checkbox" checked={!!history} onChange={(e) => onChange({ history: e.target.checked ? true : undefined })} /> Historize</label>
      {history && <>
        <label>History deadband<input type="number" value={history.deadband ?? ''} onChange={(e) => onChange({ history: { ...history, deadband: num(e.target.value) } })} /></label>
        <label>Heartbeat (s)<input type="number" value={history.interval ?? ''} placeholder="60" onChange={(e) => onChange({ history: { ...history, interval: num(e.target.value) } })} /></label>
      </>}
      <div className="span2"><JsonField label="State texts" rows={2} value={tag.states} onChange={(v) => onChange({ states: v as TagNode['states'] })} hint='{ "0": "Stopped", "1": "Running" }' /></div>
      <div className="span2"><b>Alarms</b><AlarmsEditor alarms={tag.alarms ?? []} disabled={readOnly} onChange={(a) => onChange({ alarms: a.length ? a : undefined })} /></div>
    </fieldset>
  );
}

function ChildrenTable({ prefix }: { prefix: string }) {
  const tags = useProject((s) => s.tags);
  const list = useMemo(() => [...tags.values()].filter((t) => t.path.startsWith(`${prefix}/`)).slice(0, 200), [tags, prefix]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Tag</th><th>Value</th><th>Quality</th><th>Type</th><th>Description</th></tr></thead>
        <tbody>{list.map((t) => <ChildRow key={t.path} path={t.path} prefix={prefix} />)}</tbody>
      </table>
    </div>
  );
}

function ChildRow({ path, prefix }: { path: string; prefix: string }) {
  const info = useProject((s) => s.tags.get(path))!;
  const tv = useTag(path);
  return (
    <tr className="clickable-row" onClick={() => navigate('tags', path)}>
      <td className="mono">{path.slice(prefix.length + 1)}</td>
      <td className="mono">{formatValue(tv?.value, info)}</td>
      <td className={`q-text-${tv?.quality}`}>{tv?.quality ?? '—'}</td>
      <td className="muted">{info.dataType}{info.writable ? ' · rw' : ''}</td>
      <td className="muted">{info.description ?? ''}</td>
    </tr>
  );
}

function TagsViewer({ path }: { path: string }) {
  const isTag = useProject((s) => s.tags.has(path));
  return isTag ? <LivePanel path={path} /> : <ChildrenTable prefix={path} />;
}

export function TagsPage() {
  const route = useRoute();
  const canEdit = useHasRole('engineer');
  const revision = useProject((s) => s.revision);
  const liveTree = useProject((s) => s.tree);
  const devices = useProject((s) => s.devices);
  const [nodes, setNodes] = useState<ProjectNode[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState('');
  const selected = route.param || null;

  useEffect(() => {
    if (!canEdit || dirty) return;
    api.get<ProjectNode[]>('/project/nodes').then(setNodes).catch(() => setNodes(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, revision]);

  const tree = useMemo(() => (nodes ? toTree(nodes) : liveTree), [nodes, liveTree]);
  const loc = nodes && selected ? locate(nodes, selected) : undefined;

  const mutate = (fn: (draft: ProjectNode[]) => string | void) => {
    if (!nodes) return;
    const draft = structuredClone(nodes);
    const nextSel = fn(draft);
    setNodes(draft);
    setDirty(true);
    if (typeof nextSel === 'string') navigate('tags', nextSel);
  };
  const patchSelected = (patch: Partial<ProjectNode>) => mutate((d) => {
    const l = locate(d, selected!);
    if (!l) return;
    Object.assign(l.node, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (l.node as unknown as Record<string, unknown>)[k];
    if (patch.name && patch.name !== loc?.node.name) return [...selected!.split('/').slice(0, -1), patch.name].join('/');
  });

  const add = async (kind: ProjectNode['kind']) => {
    const name = await useUi.getState().prompt(`New ${kind} name:`, kind === 'tag' ? 'NewTag' : kind === 'device' ? 'NewDevice' : 'NewFolder');
    if (!name) return;
    if (/[/\\#*?"<>|]/.test(name)) return toast('Name must not contain / \\ # * ? " < > |', 'error');
    const node: ProjectNode = kind === 'tag' ? { kind, name, dataType: 'number' } : kind === 'device' ? { kind, name, driver: 'simulation', settings: {}, children: [] } : { kind, name, children: [] };
    mutate((d) => {
      let parentPath = '';
      let list = d;
      if (selected) {
        const l = locate(d, selected)!;
        if (l.node.kind === 'tag') { list = l.siblings; parentPath = selected.split('/').slice(0, -1).join('/'); }
        else { list = (l.node.children ??= []); parentPath = selected; }
      }
      if (list.some((n) => n.name === name)) { toast(`"${name}" already exists here`, 'error'); return; }
      list.push(node);
      return parentPath ? `${parentPath}/${name}` : name;
    });
  };

  const remove = async () => {
    if (!selected || !(await useUi.getState().confirm(`Delete "${selected}" and everything below it?`))) return;
    mutate((d) => {
      const l = locate(d, selected);
      if (l) l.siblings.splice(l.index, 1);
      return selected.split('/').slice(0, -1).join('/');
    });
  };

  const move = (dir: -1 | 1) => mutate((d) => {
    const l = locate(d, selected!);
    if (!l) return;
    const j = l.index + dir;
    if (j < 0 || j >= l.siblings.length) return;
    [l.siblings[l.index], l.siblings[j]] = [l.siblings[j], l.siblings[l.index]];
  });

  const duplicate = () => mutate((d) => {
    const l = locate(d, selected!);
    if (!l) return;
    let name = `${l.node.name}_copy`;
    while (l.siblings.some((n) => n.name === name)) name += '_';
    l.siblings.splice(l.index + 1, 0, { ...structuredClone(l.node), name });
    return [...selected!.split('/').slice(0, -1), name].join('/');
  });

  const save = async () => {
    try {
      await api.put('/project/nodes', nodes);
      setDirty(false);
      toast('Tag database saved & hot-reloaded', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.issues) toast(err.issues.join(' · '), 'error');
      else errorToast(err);
    }
  };

  const node = loc?.node;
  const status = node?.kind === 'device' ? devices.get(selected!) : undefined;

  return (
    <div className="page with-sidebar">
      <Sidebar wide>
        <div className="sidebar-head">
          <span>Project nodes</span>
          {canEdit && nodes && <>
            <button className="icon-btn" title="Add folder" onClick={() => void add('folder')}><Folder size={14} /></button>
            <button className="icon-btn" title="Add device" onClick={() => void add('device')}><Cpu size={14} /></button>
            <button className="icon-btn" title="Add tag" onClick={() => void add('tag')}><Tag size={14} /></button>
          </>}
        </div>
        <div className="search"><Search size={14} /><input placeholder="Filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="sidebar-scroll">
          <Tree items={tree} filter={filter} selected={selected} defaultDepth={2} onSelect={(it) => navigate('tags', it.id)}
            renderExtra={(it) => it.kind === 'device'
              ? <span className={`dot state-${devices.get(it.id)?.state ?? 'stopped'}`} title={devices.get(it.id)?.state} />
              : null} />
        </div>
      </Sidebar>
      <main className="content">
        <div className="content-head">
          <h2>{selected ?? 'Tags'}</h2>
          {node && <span className="chip">{node.kind}{node.kind === 'device' ? ` · ${node.driver}` : ''}</span>}
          <span className="spacer" />
          {canEdit && nodes && selected && <>
            <button className="icon-btn" title="Move up" onClick={() => move(-1)}><ArrowUp size={15} /></button>
            <button className="icon-btn" title="Move down" onClick={() => move(1)}><ArrowDown size={15} /></button>
            <button className="icon-btn" title="Duplicate" onClick={duplicate}><Copy size={15} /></button>
            <button className="icon-btn" title="Delete" onClick={() => void remove()}><Trash2 size={15} /></button>
          </>}
          {canEdit && dirty && <button onClick={() => { setDirty(false); setNodes(null); void useProject.getState().refresh(); api.get<ProjectNode[]>('/project/nodes').then(setNodes); }}><RotateCcw size={14} /> Revert</button>}
          {canEdit && <button className="primary" disabled={!dirty} onClick={() => void save()}><Save size={14} /> Save & apply</button>}
        </div>
        <div className="content-body padded scroll">
          {!selected && <Empty>Select a node in the tree. {canEdit ? 'Use the icons to add folders, devices and tags.' : ''}</Empty>}
          {selected && !node && !canEdit && <TagsViewer path={selected} />}
          {node && (
            <div className="node-editor">
              <fieldset className="form grid2" disabled={!canEdit}>
                <label>Name<input value={node.name} onChange={(e) => patchSelected({ name: e.target.value })} /></label>
                {node.kind !== 'tag' && <label>Description<input value={node.description ?? ''} onChange={(e) => patchSelected({ description: e.target.value || undefined })} /></label>}
              </fieldset>
              {node.kind === 'device' && (
                <>
                  <fieldset className="form grid2" disabled={!canEdit}>
                    <label>Driver<select value={node.driver} onChange={(e) => patchSelected({ driver: e.target.value as DriverType })}>{DRIVER_TYPES.map((d) => <option key={d}>{d}</option>)}</select></label>
                    <label className="check"><input type="checkbox" checked={node.enabled !== false} onChange={(e) => patchSelected({ enabled: e.target.checked ? undefined : false })} /> Enabled</label>
                    <div className="span2"><JsonField label="Connection settings" value={node.settings} onChange={(v) => patchSelected({ settings: v as Record<string, unknown> })} hint={SETTINGS_HINT[node.driver]} /></div>
                  </fieldset>
                  {status && <div className="device-status"><span className={`dot state-${status.state}`} /> {status.state} — {status.message ?? ''} · reads {status.reads} · writes {status.writes} · errors {status.errors}</div>}
                </>
              )}
              {node.kind === 'tag' && (
                <div className="tag-editor">
                  <TagForm tag={node} driver={loc?.device?.driver} onChange={(p) => patchSelected(p)} readOnly={!canEdit} />
                  <div><h4>Live</h4>{dirty ? <div className="hint">Save to apply changes to the runtime.</div> : null}<LivePanel path={selected!} /></div>
                </div>
              )}
              {node.kind !== 'tag' && <><h4>Tags below</h4><ChildrenTable prefix={selected!} /></>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
