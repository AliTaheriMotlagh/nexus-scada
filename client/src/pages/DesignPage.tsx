import { useEffect, useMemo, useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter,
  AlignStartHorizontal, AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, Box, ClipboardPaste,
  Copy, Download, Eye, EyeOff, FilePlus2, Grid3x3, Group, Lock, Magnet, Monitor, Pencil, Play, Redo2, Save, Scissors,
  LayoutTemplate, RotateCcw, Search, Shapes, Sparkles, Trash2, Undo2, Ungroup, Upload, ZoomIn, ZoomOut,
} from 'lucide-react';
import type { DisplayDoc, TreeItem } from '@shared/types.ts';
import { Empty, Tabs } from '../components/Overlays.tsx';
import { Sidebar } from '../components/Sidebar.tsx';
import { Tree } from '../components/Tree.tsx';
import { createElement, DesignerCanvas, DND_ELEMENT, DND_TAG } from '../graphics/designer/DesignerCanvas.tsx';
import { AiAssistant } from '../graphics/designer/AiAssistant.tsx';
import { revertDesign, saveDesign, startDesignSession, useCollab } from '../graphics/designer/collab.ts';
import { TemplateGallery } from '../graphics/designer/TemplateGallery.tsx';
import { useDesigner } from '../graphics/designer/designerStore.ts';
import { PropertyPanel } from '../graphics/designer/PropertyPanel.tsx';
import { allMetas, CATEGORIES } from '../graphics/registry.ts';
import '../graphics/elements/index.ts';
import { api, enc } from '../lib/api.ts';
import { navigate, useRoute } from '../lib/router.ts';
import { useProject } from '../stores/project.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

const NEW_DISPLAY = (name: string): DisplayDoc => ({ name, title: name.split('/').pop(), width: 1600, height: 900, background: '#0f1722', grid: 10, elements: [] });

function Palette() {
  const [filter, setFilter] = useState('');
  const tool = useDesigner((s) => s.tool);
  const items = useMemo<TreeItem[]>(() => CATEGORIES.map((c) => ({
    id: `cat:${c}`, name: c, kind: 'folder',
    children: allMetas().filter((m) => m.category === c).map((m) => ({ id: m.type, name: m.label, kind: 'element', meta: { category: c } })),
  })).filter((c) => c.children!.length), []);
  return (
    <>
      <div className="search"><Search size={14} /><input placeholder="Search symbols…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <Tree items={items} filter={filter} defaultDepth={1} dragType={DND_ELEMENT}
        selected={tool?.kind === 'element' ? tool.id : null}
        onSelect={(it) => { if (!it.children) useDesigner.getState().setTool(tool?.id === it.id ? null : { kind: 'element', id: it.id, label: it.name }); }}
        renderIcon={(it) => (it.children ? undefined : <Shapes size={14} className="ic-display" />)}
        onActivate={(it) => {
          if (it.children) return;
          const d = useDesigner.getState().doc;
          if (!d) return;
          const el = createElement(it.id, d.width / 2, d.height / 2);
          if (el) useDesigner.getState().addElement(el);
        }} />
      <div className="hint">Tap a symbol, then tap the canvas to place it (or drag it onto the canvas).</div>
    </>
  );
}

/** Avatars of the other people editing this display. */
function Peers() {
  const peers = [...useCollab((s) => s.peers).values()];
  const me = useCollab((s) => s.me);
  if (!me) return null;
  return (
    <div className="peers" title={`Editing now: ${[me.user + ' (you)', ...peers.map((p) => p.user)].join(', ')}`}>
      {[me, ...peers].map((p) => <span key={p.connId} className="peer-avatar" style={{ background: p.color }}>{p.user[0].toUpperCase()}</span>)}
    </div>
  );
}

function Layers() {
  const doc = useDesigner((s) => s.doc);
  const selection = useDesigner((s) => s.selection);
  const select = useDesigner((s) => s.select);
  const update = useDesigner((s) => s.updateElement);
  if (!doc) return null;
  return (
    <div className="layers">
      {[...doc.elements].reverse().map((el) => (
        <div key={el.id} className={`layer-row ${selection.includes(el.id) ? 'selected' : ''}`} onClick={(e) => select([el.id], e.shiftKey)}>
          <span className="layer-name">{el.name ?? el.id}</span>
          <span className="muted small">{el.type}</span>
          <button className="icon-btn" onClick={(e) => { e.stopPropagation(); update(el.id, { visible: el.visible === false ? undefined : false }); }}>{el.visible === false ? <EyeOff size={13} /> : <Eye size={13} />}</button>
          <button className={`icon-btn ${el.locked ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); update(el.id, { locked: el.locked ? undefined : true }); }}><Lock size={13} /></button>
        </div>
      ))}
      {!doc.elements.length && <div className="tree-empty">No elements</div>}
    </div>
  );
}

function DisplaysTree({ current, onOpen, onNew }: { current: string | null; onOpen: (name: string) => void; onNew: () => void }) {
  const tree = useProject((s) => s.displays.tree);
  const sessions = useCollab((s) => s.sessions);
  const [filter, setFilter] = useState('');
  const create = () => onNew();
  return (
    <>
      <div className="search"><Search size={14} /><input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="icon-btn" title="New page from template" onClick={create}><FilePlus2 size={15} /></button></div>
      <Tree items={tree} filter={filter} selected={current} defaultDepth={3} onSelect={(it) => { if (!it.children) onOpen(it.id); }}
        renderExtra={(it) => (sessions[it.id] ?? []).map((p, i) => <span key={i} className="peer-dot" style={{ background: p.color }} title={`${p.user} is editing`}>{p.user[0].toUpperCase()}</span>)} />
    </>
  );
}

function TagsTab() {
  const tree = useProject((s) => s.tree);
  const tool = useDesigner((s) => s.tool);
  const [filter, setFilter] = useState('');
  return (
    <>
      <div className="search"><Search size={14} /><input placeholder="Filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <Tree items={tree} filter={filter} defaultDepth={2} dragType={DND_TAG} draggable={(it) => it.kind === 'tag'}
        selected={tool?.kind === 'tag' ? tool.id : null}
        onSelect={(it) => { if (it.kind === 'tag') useDesigner.getState().setTool(tool?.id === it.id ? null : { kind: 'tag', id: it.id, label: it.id }); }} />
      <div className="hint">Tap a tag, then tap the canvas to create a control — or tap an element to animate it with the tag. Drag & drop works too.</div>
    </>
  );
}

export function DesignPage() {
  const route = useRoute();
  const s = useDesigner();
  const [tab, setTab] = useState<'displays' | 'palette' | 'tags' | 'layers'>('palette');
  const [loading, setLoading] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [assistant, setAssistant] = useState(false);

  const open = (name: string) => navigate('design', name);

  // Join the shared (multi-user) editing session of the display in the URL.
  useEffect(() => {
    const name = route.param;
    if (!name) return;
    setLoading(true);
    return startDesignSession(name, (d) => {
      setLoading(false);
      // open "zoomed to fit" so the whole page is visible on tablets and small laptops
      const vp = document.querySelector('.content-body');
      const avail = (vp?.clientWidth ?? window.innerWidth) - 90;
      useDesigner.getState().setZoom(Math.min(1, Math.max(0.2, avail / d.width)));
    });
  }, [route.param]);

  const save = () => saveDesign();

  const remove = async () => {
    const { name } = useDesigner.getState();
    if (!name || !(await useUi.getState().confirm(`Delete display "${name}"?`))) return;
    try {
      await api.del(`/displays/${enc(name)}`);
      useDesigner.setState({ name: null, doc: null, dirty: false });
      await useProject.getState().refresh();
      navigate('design');
    } catch (err) { errorToast(err); }
  };

  const rename = async () => {
    const { name } = useDesigner.getState();
    if (!name) return;
    const to = await useUi.getState().prompt('Rename / move display to:', name);
    if (!to || to === name) return;
    try {
      await save();
      await api.post('/displays-rename', { from: name, to });
      useDesigner.setState({ name: to });
      await useProject.getState().refresh();
      navigate('design', to);
    } catch (err) { errorToast(err); }
  };

  const exportJson = () => {
    const { doc, name } = useDesigner.getState();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    a.download = `${(name ?? 'display').replace(/\//g, '_')}.json`;
    a.click();
  };

  const importJson = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const d = JSON.parse(await file.text()) as DisplayDoc;
        if (!Array.isArray(d.elements)) throw new Error('Not a display document');
        useDesigner.getState().apply((doc) => Object.assign(doc, { ...d, name: doc.name }));
      } catch (err) { errorToast(err); }
    };
    input.click();
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof Element && t.closest('input, textarea, select, .monaco-host, [contenteditable]')) return;
      const st = useDesigner.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') { e.preventDefault(); void save(); }
      else if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); st.undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); st.redo(); }
      else if (mod && k === 'c') st.copy();
      else if (mod && k === 'x') st.cut();
      else if (mod && k === 'v') st.paste();
      else if (mod && k === 'd') { e.preventDefault(); st.duplicateSelected(); }
      else if (mod && k === 'a') { e.preventDefault(); st.select(st.doc?.elements.map((x) => x.id) ?? []); }
      else if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) st.ungroup(); else st.group(); }
      else if (k === 'delete' || k === 'backspace') st.removeSelected();
      else if (k === 'escape') { st.setTool(null); st.select([]); }
      else if (k.startsWith('arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? (st.doc?.grid ?? 10) : 1;
        st.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const T = ({ icon, title, onClick, active, disabled }: { icon: React.ReactNode; title: string; onClick: () => void; active?: boolean; disabled?: boolean }) => (
    <button className={`icon-btn ${active ? 'active' : ''}`} title={title} onClick={onClick} disabled={disabled}>{icon}</button>
  );
  const sel = s.selection.length;

  return (
    <div className="page designer">
      <Sidebar wide>
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: 'palette', label: 'Palette' }, { id: 'displays', label: 'Displays' }, { id: 'tags', label: 'Tags' }, { id: 'layers', label: 'Layers' },
        ]} />
        <div className="sidebar-scroll">
          {tab === 'palette' && <Palette />}
          {tab === 'displays' && <DisplaysTree current={s.name} onOpen={open} onNew={() => setGallery(true)} />}
          {tab === 'tags' && <TagsTab />}
          {tab === 'layers' && <Layers />}
        </div>
      </Sidebar>
      <main className="content">
        <div className="toolbar designer-toolbar">
 <T icon={<LayoutTemplate size={16} />} title="New page from template / use case" onClick={() => setGallery(true)} />
          <T icon={<Sparkles size={16} />} title="AI page assistant" onClick={() => setAssistant(true)} disabled={!s.doc} />
          <span className="sep" />
          <T icon={<Save size={16} />} title="Save (Ctrl+S)" onClick={() => void save()} active={s.dirty} disabled={!s.doc} />
          <T icon={<Undo2 size={16} />} title="Undo (Ctrl+Z)" onClick={s.undo} disabled={!s.past.length} />
          <T icon={<Redo2 size={16} />} title="Redo (Ctrl+Y)" onClick={s.redo} disabled={!s.future.length} />
          <span className="sep" />
          <T icon={<Scissors size={16} />} title="Cut" onClick={s.cut} disabled={!sel} />
          <T icon={<Copy size={16} />} title="Copy" onClick={s.copy} disabled={!sel} />
          <T icon={<ClipboardPaste size={16} />} title="Paste" onClick={s.paste} disabled={!s.clipboard.length} />
          <T icon={<Trash2 size={16} />} title="Delete" onClick={s.removeSelected} disabled={!sel} />
          <span className="sep" />
          <T icon={<AlignStartVertical size={16} />} title="Align left" onClick={() => s.align('left')} disabled={sel < 2} />
          <T icon={<AlignCenterVertical size={16} />} title="Align centre" onClick={() => s.align('hcenter')} disabled={sel < 2} />
          <T icon={<AlignEndVertical size={16} />} title="Align right" onClick={() => s.align('right')} disabled={sel < 2} />
          <T icon={<AlignStartHorizontal size={16} />} title="Align top" onClick={() => s.align('top')} disabled={sel < 2} />
          <T icon={<AlignCenterHorizontal size={16} />} title="Align middle" onClick={() => s.align('vcenter')} disabled={sel < 2} />
          <T icon={<AlignEndHorizontal size={16} />} title="Align bottom" onClick={() => s.align('bottom')} disabled={sel < 2} />
          <T icon={<AlignHorizontalDistributeCenter size={16} />} title="Distribute horizontally" onClick={() => s.distribute('h')} disabled={sel < 3} />
          <T icon={<AlignVerticalDistributeCenter size={16} />} title="Distribute vertically" onClick={() => s.distribute('v')} disabled={sel < 3} />
          <span className="sep" />
          <T icon={<ArrowUpToLine size={16} />} title="Bring to front" onClick={() => s.zorder('front')} disabled={!sel} />
          <T icon={<ArrowDownToLine size={16} />} title="Send to back" onClick={() => s.zorder('back')} disabled={!sel} />
          <T icon={<Group size={16} />} title="Group (Ctrl+G)" onClick={s.group} disabled={sel < 2} />
          <T icon={<Ungroup size={16} />} title="Ungroup (Ctrl+Shift+G)" onClick={s.ungroup} disabled={!sel} />
          <span className="sep" />
          <T icon={<ZoomOut size={16} />} title="Zoom out" onClick={() => s.setZoom(s.zoom - 0.1)} />
          <button className="zoom-label" title="Fit to screen (click) " onClick={() => {
            const vp = document.querySelector('.designer-viewport');
            if (s.doc && vp) s.setZoom(Math.min((vp.clientWidth - 90) / s.doc.width, (vp.clientHeight - 90) / s.doc.height));
          }}>{Math.round(s.zoom * 100)}%</button>
          <T icon={<ZoomIn size={16} />} title="Zoom in" onClick={() => s.setZoom(s.zoom + 0.1)} />
          <T icon={<Grid3x3 size={16} />} title="Show grid" onClick={() => s.toggle('showGrid')} active={s.showGrid} />
          <T icon={<Magnet size={16} />} title="Snap to grid" onClick={() => s.toggle('snap')} active={s.snap} />
          <T icon={<Play size={16} />} title="Live preview (bindings on)" onClick={() => s.toggle('preview')} active={s.preview} />
          <span className="spacer" />
          <Peers />
          <T icon={<RotateCcw size={16} />} title="Discard unsaved changes (for everyone)" onClick={() => void useUi.getState().confirm('Discard all unsaved changes of this display for every editor?').then((ok) => { if (ok) void revertDesign(); })} disabled={!s.dirty} />
          <T icon={<Upload size={16} />} title="Import JSON" onClick={importJson} disabled={!s.doc} />
          <T icon={<Download size={16} />} title="Export JSON" onClick={exportJson} disabled={!s.doc} />
          <T icon={<Pencil size={16} />} title="Rename / move" onClick={() => void rename()} disabled={!s.doc} />
          <T icon={<Trash2 size={16} />} title="Delete display" onClick={() => void remove()} disabled={!s.doc} />
          <button onClick={() => s.name && navigate('view', s.name)} disabled={!s.name}><Monitor size={14} /> Runtime</button>
        </div>
        <div className="content-body">
          {loading && <div className="loading">Loading…</div>}
          {!s.doc && !loading && (
            <Empty>
              <Box size={28} /><br />Open a display from the <b>Displays</b> tab, or start from a real use case.<br /><br />
              <button className="primary" onClick={() => setGallery(true)}><LayoutTemplate size={14} /> Templates & use cases</button>
            </Empty>
          )}
          {s.doc && <DesignerCanvas />}
        </div>
        <div className="statusbar">
          <span>{s.name ?? '—'}{s.dirty ? ' • modified' : ''}</span>
          <span>{s.doc ? `${s.doc.width}×${s.doc.height}` : ''}</span>
          <span>{s.doc?.elements.length ?? 0} elements</span>
          <span>{sel ? `${sel} selected` : ''}</span>
          <span className="spacer" />
          <span className="muted">Arrows nudge · Shift = grid step · Ctrl+D duplicate · Del delete</span>
        </div>
      </main>
      <Sidebar side="right">{s.doc && <PropertyPanel />}</Sidebar>
      {gallery && <TemplateGallery onClose={() => setGallery(false)} onAi={s.doc ? () => setAssistant(true) : undefined} />}
      {assistant && <AiAssistant onClose={() => setAssistant(false)} />}
    </div>
  );
}
