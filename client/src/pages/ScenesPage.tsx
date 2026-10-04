import { lazy, Suspense, useEffect, useState } from 'react';
import { Copy, FilePlus2, Move3d, Pencil, Plus, Rotate3d, Save, Scale3d, Search, Trash2 } from 'lucide-react';
import type { SceneDoc, SceneObject, Vec3 } from '@shared/types.ts';
import { Empty, Tabs } from '../components/Overlays.tsx';
import { TagPicker } from '../components/TagPicker.tsx';
import { Tree } from '../components/Tree.tsx';
import { api, enc } from '../lib/api.ts';
import { uid } from '../lib/format.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { OBJECT_TYPES } from '../scene3d/objectTypes.ts';
import type { TransformMode } from '../scene3d/SceneView.tsx';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const SceneView = lazy(() => import('../scene3d/SceneView.tsx'));

const NEW_SCENE = (name: string): SceneDoc => ({
  name, title: name.split('/').pop(), environment: 'studio', grid: true, shadows: true,
  camera: { position: [6, 5, 8], target: [0, 0.5, 0], fov: 45 }, objects: [],
});

function Vec({ label, value, onChange, step = 0.1 }: { label: string; value: Vec3; onChange: (v: Vec3) => void; step?: number }) {
  return (
    <div className="vec-row">
      <span className="prop-label">{label}</span>
      {value.map((v, i) => (
        <input key={i} type="number" step={step} value={v} onChange={(e) => {
          const next = [...value] as Vec3;
          next[i] = Number(e.target.value);
          onChange(next);
        }} />
      ))}
    </div>
  );
}

function ObjectPanel({ obj, onChange, onDelete }: { obj: SceneObject; onChange: (patch: Partial<SceneObject>) => void; onDelete: () => void }) {
  const info = OBJECT_TYPES.find((t) => t.type === obj.type);
  const displays = useProject((s) => s.displays.names);
  const props = Object.entries({ ...info?.props, ...obj.props });
  const setBinding = (prop: string, tag: string) => {
    const b = { ...obj.bindings };
    if (tag) b[prop] = { ...b[prop], tag };
    else delete b[prop];
    onChange({ bindings: b });
  };
  return (
    <div className="property-panel">
      <div className="panel-title">{info?.label ?? obj.type} <span className="muted small mono">{obj.id}</span></div>
      <label className="row-field">Name<input value={obj.name ?? ''} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <Vec label="Position" value={obj.position} onChange={(position) => onChange({ position })} />
      <Vec label="Rotation" value={obj.rotation} onChange={(rotation) => onChange({ rotation })} step={0.05} />
      <Vec label="Scale" value={obj.scale} onChange={(scale) => onChange({ scale })} />
      <details className="prop-section" open>
        <summary>Properties</summary>
        {props.map(([k, v]) => (
          <div className="prop-line" key={k}>
            <span className="prop-label">{k}</span>
            <span className="prop-input">
              {typeof v === 'boolean'
                ? <input type="checkbox" checked={Boolean(obj.props[k] ?? v)} onChange={(e) => onChange({ props: { ...obj.props, [k]: e.target.checked } })} />
                : typeof v === 'number'
                  ? <input type="number" value={Number(obj.props[k] ?? v)} onChange={(e) => onChange({ props: { ...obj.props, [k]: Number(e.target.value) } })} />
                  : <input value={String(obj.props[k] ?? v)} onChange={(e) => onChange({ props: { ...obj.props, [k]: e.target.value } })} />}
            </span>
          </div>
        ))}
        <div className="prop-line">
          <span className="prop-label">showLabel</span>
          <span className="prop-input"><input type="checkbox" checked={Boolean(obj.props.showLabel)} onChange={(e) => onChange({ props: { ...obj.props, showLabel: e.target.checked } })} /></span>
        </div>
      </details>
      <details className="prop-section" open>
        <summary>Tag bindings</summary>
        {[...new Set([info?.primary, ...Object.keys(obj.bindings ?? {}), 'color', 'visible'].filter(Boolean) as string[])].map((prop) => (
          <label key={prop} className="row-field">{prop}<TagPicker value={obj.bindings?.[prop]?.tag ?? ''} onChange={(t) => setBinding(prop, t)} /></label>
        ))}
        <div className="hint">For colour by state etc. use the YAML (bindings support expr & map rules like 2D displays).</div>
      </details>
      <details className="prop-section" open>
        <summary>Click</summary>
        <label className="row-field">Faceplate<TagPicker allowFolders value={obj.faceplate?.path ?? ''} onChange={(path) => onChange({ faceplate: path ? { ...obj.faceplate, path } : undefined })} /></label>
        <label className="row-field">Display
          <select value={obj.faceplate?.display ?? ''} disabled={!obj.faceplate} onChange={(e) => onChange({ faceplate: { path: obj.faceplate!.path, display: e.target.value || undefined } })}>
            <option value="">(generic)</option>{displays.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
      </details>
      <button className="danger" onClick={onDelete}><Trash2 size={14} /> Delete object</button>
    </div>
  );
}

export function ScenesPage() {
  const route = useRoute();
  const scenes = useProject((s) => s.scenes);
  const revision = useProject((s) => s.revision);
  const canEdit = useHasRole('engineer');
  const name = route.param || scenes.names[0];
  const [doc, setDoc] = useState<SceneDoc | null>(null);
  const [edit, setEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<TransformMode>('translate');
  const [tab, setTab] = useState<'scenes' | 'add'>('scenes');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!name || (edit && dirty)) return;
    api.get<SceneDoc>(`/scenes/${enc(name)}`).then((d) => { setDoc(d); setDirty(false); }).catch(errorToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, revision]);

  const update = (fn: (d: SceneDoc) => SceneDoc) => {
    setDoc((d) => (d ? fn(structuredClone(d)) : d));
    setDirty(true);
  };
  const patchObj = (id: string, patch: Partial<SceneObject>) => update((d) => ({ ...d, objects: d.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  const save = async () => {
    if (!doc || !name) return;
    try {
      await api.put(`/scenes/${enc(name)}`, doc);
      setDirty(false);
      toast(`Saved scene ${name}`, 'success');
    } catch (err) { errorToast(err); }
  };

  const create = async () => {
    const n = await useUi.getState().prompt('New 3D scene name:', 'Plant/NewScene');
    if (!n) return;
    try {
      await api.put(`/scenes/${enc(n)}`, NEW_SCENE(n));
      await useProject.getState().refresh();
      navigate('scenes', n);
      setEdit(true);
    } catch (err) { errorToast(err); }
  };

  const addObject = (type: SceneObject['type']) => {
    const info = OBJECT_TYPES.find((t) => t.type === type)!;
    const obj: SceneObject = {
      id: uid('o'), type, name: info.label, position: [0, type === 'tank' ? 1.35 : 0.5, 0], rotation: [0, 0, 0],
      scale: type === 'pipe' ? [3, 1, 1] : type === 'plane' ? [10, 1, 10] : [1, 1, 1], props: { ...info.props },
    };
    update((d) => ({ ...d, objects: [...d.objects, obj] }));
    setSelected(obj.id);
  };

  const sel = doc?.objects.find((o) => o.id === selected);

  return (
    <div className="page with-sidebar">
      <aside className="sidebar">
        {edit ? (
          <Tabs value={tab} onChange={setTab} tabs={[{ id: 'scenes', label: 'Scenes' }, { id: 'add', label: 'Add object' }]} />
        ) : <div className="sidebar-head"><span>3D Scenes</span>{canEdit && <button className="icon-btn" onClick={() => void create()} title="New scene"><FilePlus2 size={15} /></button>}</div>}
        <div className="sidebar-scroll">
          {(!edit || tab === 'scenes') && (
            <>
              <div className="search"><Search size={14} /><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
              <Tree items={scenes.tree} filter={filter} selected={name} defaultDepth={3} onSelect={(it) => { if (!it.children) navigate('scenes', it.id); }} />
              {edit && doc && (
                <>
                  <div className="sidebar-head"><span>Objects</span></div>
                  {doc.objects.map((o) => (
                    <div key={o.id} className={`layer-row ${selected === o.id ? 'selected' : ''}`} onClick={() => setSelected(o.id)}>
                      <span className="layer-name">{o.name ?? o.id}</span><span className="muted small">{o.type}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
          {edit && tab === 'add' && (
            <div className="add-grid">
              {OBJECT_TYPES.map((t) => <button key={t.type} onClick={() => addObject(t.type)}><Plus size={13} /> {t.label}</button>)}
            </div>
          )}
        </div>
      </aside>
      <main className="content">
        <div className="content-head">
          <h2>{doc?.title ?? name ?? '3D'}</h2>
          <span className="muted small">{name}{dirty ? ' • modified' : ''}</span>
          <span className="spacer" />
          {edit && (
            <>
              <button className={`icon-btn ${mode === 'translate' ? 'active' : ''}`} title="Move (gizmo)" onClick={() => setMode('translate')}><Move3d size={16} /></button>
              <button className={`icon-btn ${mode === 'rotate' ? 'active' : ''}`} title="Rotate" onClick={() => setMode('rotate')}><Rotate3d size={16} /></button>
              <button className={`icon-btn ${mode === 'scale' ? 'active' : ''}`} title="Scale" onClick={() => setMode('scale')}><Scale3d size={16} /></button>
              <button className="icon-btn" title="Duplicate" disabled={!sel} onClick={() => {
                if (!sel) return;
                const copy = { ...structuredClone(sel), id: uid('o'), position: [sel.position[0] + 1, sel.position[1], sel.position[2]] as Vec3 };
                update((d) => ({ ...d, objects: [...d.objects, copy] }));
                setSelected(copy.id);
              }}><Copy size={16} /></button>
              <select value={doc?.environment ?? 'studio'} onChange={(e) => update((d) => ({ ...d, environment: e.target.value as SceneDoc['environment'] }))} title="Lighting">
                <option value="studio">studio light</option><option value="sunset">sunset light</option><option value="none">plain light</option>
              </select>
              <button className="primary" onClick={() => void save()} disabled={!dirty}><Save size={14} /> Save</button>
            </>
          )}
          {canEdit && name && <button className={edit ? 'active' : ''} onClick={() => { setEdit(!edit); setSelected(null); }}><Pencil size={14} /> {edit ? 'Done' : 'Edit'}</button>}
        </div>
        <div className="content-body scene-body">
          {!name && <Empty>No 3D scenes yet.{canEdit ? ' Click + to create one.' : ''}</Empty>}
          {doc && (
            <Suspense fallback={<div className="loading">Loading 3D engine…</div>}>
              <SceneView doc={doc} mode={edit ? 'design' : 'runtime'} selected={selected} onSelect={setSelected} transformMode={mode}
                onTransform={(id, patch) => patchObj(id, patch)} />
            </Suspense>
          )}
          {!edit && doc && <div className="scene-hint">Drag to orbit · scroll to zoom · click equipment for its faceplate</div>}
        </div>
      </main>
      {edit && sel && (
        <aside className="sidebar right">
          <ObjectPanel obj={sel} onChange={(p) => patchObj(sel.id, p)} onDelete={() => { update((d) => ({ ...d, objects: d.objects.filter((o) => o.id !== sel.id) })); setSelected(null); }} />
        </aside>
      )}
    </div>
  );
}
