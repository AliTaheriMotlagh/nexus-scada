import { useMemo, useState } from 'react';
import { LayoutTemplate, Play, Sparkles } from 'lucide-react';
import { PAGE_SIZES, TEMPLATES, type TemplateCategory } from '@shared/templates/index.ts';
import { Modal } from '../../components/Overlays.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { useProject } from '../../stores/project.ts';
import { errorToast, toast } from '../../stores/ui.ts';
import { DocPreview } from './DocPreview.tsx';

const CATS: ('All' | TemplateCategory)[] = ['All', 'Water', 'Building', 'Energy', 'Industry', 'Food & Agri', 'Home', 'Layout'];

/** Gallery of real-world use cases and layouts. Installing creates simulated tags, scripts and the page. */
export function TemplateGallery({ onClose, onAi }: { onClose: () => void; onAi?: () => void }) {
  const [cat, setCat] = useState<(typeof CATS)[number]>('All');
  const [picked, setPicked] = useState(TEMPLATES[0].id);
  const tpl = TEMPLATES.find((t) => t.id === picked)!;
  const [name, setName] = useState(tpl.defaultName);
  const [parent, setParent] = useState('Sites');
  const [busy, setBusy] = useState(false);
  const demo = useProject((s) => s.info?.demo);
  const displays = useProject((s) => s.displays.names);
  const previews = useMemo(() => new Map(TEMPLATES.map((t) => [t.id, t.display(`Sites/${t.defaultName}`, t.name)])), []);
  const list = TEMPLATES.filter((t) => cat === 'All' || t.category === cat);
  const preinstalled = displays.includes(`Sites/${tpl.defaultName}`) ? `Sites/${tpl.defaultName}` : null;

  const choose = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setPicked(id);
    setName(t.defaultName);
    setParent(t.category === 'Layout' ? 'Pages' : 'Sites');
  };

  const install = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ display: string; base: string; scripts: string[] }>('/templates/install', { id: tpl.id, parent, name, title: tpl.category === 'Layout' ? undefined : tpl.name });
      await useProject.getState().refresh();
      toast(`Created ${r.display}${tpl.nodes ? ` with simulated tags in ${r.base}` : ''}${r.scripts.length ? ` and script ${r.scripts.join(', ')}` : ''}`, 'success');
      onClose();
      navigate('design', r.display);
    } catch (err) {
      if (err instanceof ApiError && err.issues) toast(err.issues.join(' · '), 'error');
      else errorToast(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={<><LayoutTemplate size={16} /> New page — templates & real use cases</>} onClose={onClose} width="min(1180px, 98vw)" className="gallery-modal"
      footer={<>
        {onAi && <button onClick={() => { onClose(); onAi(); }}><Sparkles size={14} /> Generate with AI instead</button>}
        <span className="spacer" />
        {preinstalled && <button onClick={() => { onClose(); navigate('view', preinstalled); }}><Play size={14} /> Open live demo</button>}
        <button className="primary" disabled={busy || demo || !name} title={demo ? 'Disabled in the public demo' : ''} onClick={() => void install()}>
          {busy ? 'Creating…' : tpl.nodes ? 'Create page + simulated tags' : 'Create page'}
        </button>
      </>}>
      <div className="gallery">
        <div className="gallery-cats">{CATS.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c}</button>)}</div>
        <div className="gallery-body">
          <div className="gallery-grid">
            {list.map((t) => (
              <button key={t.id} className={`gallery-card ${t.id === picked ? 'selected' : ''}`} onClick={() => choose(t.id)}>
                <DocPreview doc={previews.get(t.id)!} width={t.size === 'phone' ? 90 : 200} />
                <span className="gc-name">{t.name}</span>
                <span className="gc-meta">{t.category} · {PAGE_SIZES[t.size].label}</span>
              </button>
            ))}
          </div>
          <div className="gallery-detail">
            <h3>{tpl.name}</h3>
            <p>{tpl.description}</p>
            {tpl.features && <ul>{tpl.features.map((f) => <li key={f}>{f}</li>)}</ul>}
            <p className="muted small">{tpl.nodes ? 'Creates a simulated device with all tags (replace the driver with Modbus/MQTT/REST later)' : 'Layout only — no tags'}{tpl.scripts ? ' plus a TypeScript control script.' : '.'}</p>
            <div className="form">
              <label>Name<input value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, ''))} /></label>
              <label>Folder<input value={parent} onChange={(e) => setParent(e.target.value)} /></label>
            </div>
            {demo && <div className="hint">The public demo cannot save — every use case is already installed under <b>Sites/</b>. Use “Open live demo”.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
