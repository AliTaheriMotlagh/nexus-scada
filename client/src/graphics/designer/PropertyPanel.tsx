import { useState } from 'react';
import { Code2, Link2, Link2Off, Plus, Trash2 } from 'lucide-react';
import type { Binding, DisplayDoc, ElementDoc, Role } from '@shared/types.ts';
import { TagPicker } from '../../components/TagPicker.tsx';
import { Modal } from '../../components/Overlays.tsx';
import { CodeEditor } from '../../editor/LazyMonaco.tsx';
import { useProject } from '../../stores/project.ts';
import { COMMON_BINDABLE, getMeta, type PropDef } from '../registry.ts';
import { useDesigner } from './designerStore.ts';

const EVENT_NAMES = ['click', 'dblclick', 'mousedown', 'mouseup', 'change'] as const;

const SCRIPT_HELP = `// Page scripts use the same TypeScript API as server scripts (+ ui, display, element).
// Examples:
//   await tags.write('Plant/Area1/Tank1/Pump/Running', true);
//   if (await ui.confirm('Start pump?')) await tags.toggle('Plant/Area1/Tank1/Pump/Running');
//   ui.openFaceplate('Plant/Area1/Tank1');
//   element?.set('fill', tags.get('Plant/Area1/Pressure') > 7 ? 'red' : 'green');
`;

export function ScriptEditorModal({ title, value, onSave, onClose, path }: { title: string; value: string; onSave: (code: string) => void; onClose: () => void; path: string }) {
  const [code, setCode] = useState(value || SCRIPT_HELP);
  return (
    <Modal title={<><Code2 size={16} /> {title}</>} onClose={onClose} width="min(1000px, 94vw)" className="script-modal"
      footer={<>
        <span className="muted small">TypeScript · Ctrl+S to save · same API as server scripts</span>
        <span className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { onSave(code.trim() === SCRIPT_HELP.trim() ? '' : code); onClose(); }}>Apply</button>
      </>}>
      <div style={{ height: '60vh' }}>
        <CodeEditor value={code} onChange={setCode} language="typescript" scriptKind="client" path={path} onSave={() => { onSave(code); onClose(); }} />
      </div>
    </Modal>
  );
}

export function PropInput({ def, value, onChange }: { def: PropDef; value: unknown; onChange: (v: unknown) => void }) {
  const displays = useProject((s) => s.displays.names);
  const scenes = useProject((s) => s.scenes.names);
  switch (def.type) {
    case 'number':
      return <input type="number" value={value === undefined || value === null ? '' : String(value)} min={def.min} max={def.max} step={def.step ?? 'any'}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />;
    case 'boolean':
      return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
    case 'color':
      return (
        <div className="color-input">
          <input type="color" value={/^#[\da-f]{6}$/i.test(String(value)) ? String(value) : '#000000'} onChange={(e) => onChange(e.target.value)} />
          <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case 'select':
      return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>{def.options!.map((o) => <option key={o}>{o}</option>)}</select>;
    case 'text':
      return <textarea rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'tag':
      return <TagPicker value={String(value ?? '')} onChange={onChange} />;
    case 'tags':
      return (
        <div className="tags-input">
          <textarea rows={3} value={String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean).join('\n')}
            onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).join(','))} placeholder="one tag per line" />
          <TagPicker value="" placeholder="add tag…" onChange={(p) => { if (p) onChange([...String(value ?? '').split(',').filter(Boolean), p].join(',')); }} />
        </div>
      );
    case 'display':
      return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="" />{displays.map((d) => <option key={d}>{d}</option>)}</select>;
    case 'scene':
      return <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}><option value="" />{scenes.map((d) => <option key={d}>{d}</option>)}</select>;
    default:
      return <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

function BindingEditor({ binding, onChange }: { binding: Binding; onChange: (b: Binding | undefined) => void }) {
  const map = binding.map ?? [];
  return (
    <div className="binding-editor">
      <label>Tag<TagPicker value={binding.tag ?? ''} onChange={(tag) => onChange({ ...binding, tag: tag || undefined })} /></label>
      <label title="TypeScript expression. value = tag value, tag('path') reads any tag, params = faceplate params">
        Expression
        <input className="mono" placeholder="e.g. value > 80 ? '#ef4444' : '#22c55e'" value={binding.expr ?? ''} onChange={(e) => onChange({ ...binding, expr: e.target.value || undefined })} />
      </label>
      <div className="map-rules">
        <div className="map-head">Value map <button className="icon-btn" title="Add rule" onClick={() => onChange({ ...binding, map: [...map, { when: map.length ? 'default' : '>50', value: '' }] })}><Plus size={13} /></button></div>
        {map.map((r, i) => (
          <div key={i} className="map-row">
            <input className="mono" value={r.when} title='">80", "<=20", "==true", "10..20", "Running", "default"' onChange={(e) => onChange({ ...binding, map: map.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)) })} />
            <span>→</span>
            <input value={String(r.value ?? '')} onChange={(e) => {
              const raw = e.target.value;
              const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
              onChange({ ...binding, map: map.map((x, j) => (j === i ? { ...x, value } : x)) });
            }} />
            <button className="icon-btn" onClick={() => onChange({ ...binding, map: map.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button className="danger small" onClick={() => onChange(undefined)}><Link2Off size={13} /> Remove binding</button>
    </div>
  );
}

function PropRow({ el, def, bindOnly }: { el: ElementDoc; def: PropDef; bindOnly?: boolean }) {
  const updateProps = useDesigner((s) => s.updateProps);
  const setBinding = useDesigner((s) => s.setBinding);
  const binding = el.bindings?.[def.name];
  const [open, setOpen] = useState(false);
  const bindable = def.bindable !== false;
  return (
    <div className={`prop-row ${binding ? 'bound' : ''}`}>
      <div className="prop-line">
        <span className="prop-label" title={def.help ?? def.name}>{def.label ?? def.name}</span>
        <span className="prop-input">
          {binding && !open
            ? <span className="bound-chip" onClick={() => setOpen(true)} title="Edit binding">{binding.tag ?? 'expr'}{binding.expr ? ' ƒ' : ''}{binding.map?.length ? ' ⇄' : ''}</span>
            : bindOnly ? <span className="muted small">{binding ? '' : 'not animated'}</span> : <PropInput def={def} value={el.props[def.name]} onChange={(v) => updateProps(el.id, { [def.name]: v })} />}
        </span>
        {bindable && (
          <button className={`icon-btn ${binding ? 'active' : ''}`} title="Bind to tag / expression (animation)" onClick={() => setOpen(!open)}><Link2 size={14} /></button>
        )}
      </div>
      {open && <BindingEditor binding={binding ?? {}} onChange={(b) => { setBinding(el.id, def.name, b); if (!b) setOpen(false); }} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="prop-section" open><summary>{title}</summary>{children}</details>;
}

function ElementPanel({ el }: { el: ElementDoc }) {
  const update = useDesigner((s) => s.updateElement);
  const name = useDesigner((s) => s.name);
  const displays = useProject((s) => s.displays.names);
  const [script, setScript] = useState<string | null>(null);
  const meta = getMeta(el.type);
  const num = (k: 'x' | 'y' | 'w' | 'h' | 'rotation' | 'opacity') => (
    <label className="geo">{k}<input type="number" value={el[k] ?? (k === 'opacity' ? 1 : 0)} step={k === 'opacity' ? 0.05 : 1}
      onChange={(e) => update(el.id, { [k]: Number(e.target.value) })} /></label>
  );
  const groups = new Map<string, PropDef[]>();
  for (const p of meta?.props ?? []) {
    const g = p.group ?? 'Appearance';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }
  return (
    <>
      <div className="panel-title">{meta?.label ?? el.type} <span className="muted mono small">{el.id}</span></div>
      <Section title="General">
        <label className="row-field">Name<input value={el.name ?? ''} onChange={(e) => update(el.id, { name: e.target.value || undefined })} /></label>
        <div className="geo-grid">{num('x')}{num('y')}{num('w')}{num('h')}{num('rotation')}{num('opacity')}</div>
        <div className="checks">
          <label><input type="checkbox" checked={el.visible !== false} onChange={(e) => update(el.id, { visible: e.target.checked ? undefined : false })} /> Visible</label>
          <label><input type="checkbox" checked={!!el.locked} onChange={(e) => update(el.id, { locked: e.target.checked || undefined })} /> Locked</label>
        </div>
        <label className="row-field">Tooltip<input value={el.tooltip ?? ''} onChange={(e) => update(el.id, { tooltip: e.target.value || undefined })} /></label>
        <label className="row-field">Min. role
          <select value={el.role ?? ''} onChange={(e) => update(el.id, { role: (e.target.value || undefined) as Role | undefined })}>
            <option value="">(anyone)</option><option>operator</option><option>engineer</option><option>admin</option>
          </select>
        </label>
      </Section>
      {[...groups].map(([g, defs]) => (
        <Section key={g} title={g}>{defs.map((d) => <PropRow key={d.name} el={el} def={d} />)}</Section>
      ))}
      <Section title="Animation (common)">{COMMON_BINDABLE.map((d) => <PropRow key={d.name} el={el} def={d} bindOnly />)}</Section>
      <Section title="Events (TypeScript)">
        {EVENT_NAMES.map((ev) => (
          <div key={ev} className="prop-line">
            <span className="prop-label">{ev}</span>
            <span className="prop-input muted small">{el.events?.[ev] ? `${el.events[ev]!.split('\n').length} line(s)` : '—'}</span>
            <button className={`icon-btn ${el.events?.[ev] ? 'active' : ''}`} onClick={() => setScript(ev)} title="Edit script"><Code2 size={14} /></button>
          </div>
        ))}
      </Section>
      <Section title="Faceplate on click">
        <label className="row-field">Path<TagPicker allowFolders value={el.faceplate?.path ?? ''} placeholder="Tag folder, e.g. Plant/Area1/Tank1 or {$path}"
          onChange={(path) => update(el.id, { faceplate: path ? { ...el.faceplate, path } : undefined })} /></label>
        <label className="row-field">Display
          <select value={el.faceplate?.display ?? ''} disabled={!el.faceplate?.path} onChange={(e) => update(el.id, { faceplate: { path: el.faceplate!.path, display: e.target.value || undefined } })}>
            <option value="">(generic faceplate)</option>{displays.map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
      </Section>
      {script && (
        <ScriptEditorModal title={`${el.name ?? el.id} · ${script}`} path={`${name}/${el.id}/${script}`} value={el.events?.[script as 'click'] ?? ''}
          onClose={() => setScript(null)}
          onSave={(code) => update(el.id, { events: { ...el.events, [script]: code || undefined } })} />
      )}
    </>
  );
}

function DisplayPanel({ doc }: { doc: DisplayDoc }) {
  const apply = useDesigner((s) => s.apply);
  const name = useDesigner((s) => s.name);
  const [script, setScript] = useState<'onOpen' | 'onClose' | 'onTimer' | null>(null);
  const set = (patch: Partial<DisplayDoc>) => apply((d) => Object.assign(d, patch));
  return (
    <>
      <div className="panel-title">Display <span className="muted small">{name}</span></div>
      <Section title="Page">
        <label className="row-field">Title<input value={doc.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></label>
        <label className="row-field">Kind
          <select value={doc.kind ?? 'page'} onChange={(e) => set({ kind: e.target.value as DisplayDoc['kind'] })}><option>page</option><option>faceplate</option><option>popup</option></select>
        </label>
        <div className="geo-grid">
          <label className="geo">width<input type="number" value={doc.width} onChange={(e) => set({ width: Number(e.target.value) })} /></label>
          <label className="geo">height<input type="number" value={doc.height} onChange={(e) => set({ height: Number(e.target.value) })} /></label>
          <label className="geo">grid<input type="number" value={doc.grid ?? 10} onChange={(e) => set({ grid: Number(e.target.value) })} /></label>
        </div>
        <label className="row-field">Background<PropInput def={{ name: 'bg', type: 'color' }} value={doc.background ?? '#0f1722'} onChange={(v) => set({ background: String(v) })} /></label>
        <label className="row-field">Bg image<input value={doc.backgroundImage ?? ''} placeholder="URL" onChange={(e) => set({ backgroundImage: e.target.value || undefined })} /></label>
        <label className="row-field" title="Faceplate template parameters, referenced as {$name}">Params<input value={(doc.params ?? []).join(',')} placeholder="path" onChange={(e) => set({ params: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
      </Section>
      <Section title="Display scripts (TypeScript)">
        {(['onOpen', 'onTimer', 'onClose'] as const).map((k) => (
          <div key={k} className="prop-line">
            <span className="prop-label">{k}</span>
            <span className="prop-input muted small">{doc.scripts?.[k] ? `${doc.scripts[k]!.split('\n').length} line(s)` : '—'}</span>
            <button className={`icon-btn ${doc.scripts?.[k] ? 'active' : ''}`} onClick={() => setScript(k)}><Code2 size={14} /></button>
          </div>
        ))}
        <label className="row-field">Timer ms<input type="number" value={doc.scripts?.timerMs ?? 1000} onChange={(e) => set({ scripts: { ...doc.scripts, timerMs: Number(e.target.value) } })} /></label>
      </Section>
      <div className="hint">Drag symbols from the palette, or drag tags from the Tags tab onto the canvas (or onto an element to bind it).</div>
      {script && (
        <ScriptEditorModal title={`${name} · ${script}`} path={`${name}/${script}`} value={doc.scripts?.[script] ?? ''} onClose={() => setScript(null)}
          onSave={(code) => set({ scripts: { ...doc.scripts, [script]: code || undefined } })} />
      )}
    </>
  );
}

export function PropertyPanel() {
  const doc = useDesigner((s) => s.doc);
  const selection = useDesigner((s) => s.selection);
  if (!doc) return null;
  if (selection.length > 1) {
    return <div className="panel-title">{selection.length} elements selected <div className="hint">Use the toolbar to align, distribute or group.</div></div>;
  }
  const el = selection.length === 1 ? doc.elements.find((e) => e.id === selection[0]) : undefined;
  return <div className="property-panel">{el ? <ElementPanel key={el.id} el={el} /> : <DisplayPanel doc={doc} />}</div>;
}
