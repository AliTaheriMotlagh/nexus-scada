import { useEffect, useState } from 'react';
import { Sparkles, Wand2 } from 'lucide-react';
import { generateFromTags } from '@shared/generator.ts';
import { PAGE_SIZES, type PageSize } from '@shared/templates/index.ts';
import type { DisplayDoc } from '@shared/types.ts';
import { Modal } from '../../components/Overlays.tsx';
import { TagPicker } from '../../components/TagPicker.tsx';
import { api } from '../../lib/api.ts';
import { uid } from '../../lib/format.ts';
import { useProject } from '../../stores/project.ts';
import { errorToast, toast } from '../../stores/ui.ts';
import { catalogForAi } from '../registry.ts';
import { useDesigner } from './designerStore.ts';

interface AiStatus { enabled: boolean; provider: string | null; model: string | null; providers: string[] }

const EXAMPLES = [
  'Overview of the pump station with the wet well, the three pumps, discharge header, gauges and a trend',
  'Mobile dashboard for my home: lights, thermostat and energy, big touch buttons',
  'Boiler room page with both boilers, steam header pressure gauge and alarm list',
  'Make the current page more readable: align everything, group into panels and add a trend',
];

/** Replace the open page with a generated one (one undoable step, synced to collaborators). */
function applyGenerated(doc: Omit<DisplayDoc, 'name'>): void {
  const ids = new Set<string>();
  const elements = doc.elements.map((e) => {
    const id = !e.id || ids.has(e.id) ? uid('ai') : e.id;
    ids.add(id);
    return { ...e, id };
  });
  useDesigner.getState().apply((d) => {
    d.elements = elements;
    d.width = doc.width;
    d.height = doc.height;
    d.background = doc.background;
    if (doc.title) d.title = doc.title;
  });
  useDesigner.getState().select([]);
  toast(`Generated ${elements.length} elements — Ctrl+Z (undo) to go back`, 'success');
}

export function AiAssistant({ onClose }: { onClose: () => void }) {
  const doc = useDesigner((s) => s.doc);
  const tags = useProject((s) => s.tags);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState('');
  const [size, setSize] = useState<PageSize>(() => (doc && doc.width < 700 ? 'phone' : doc && doc.width < 1300 ? 'tablet' : 'desktop'));
  const [improve, setImprove] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<AiStatus>('/ai/status').then(setStatus).catch(() => setStatus(null)); }, []);

  const scopedTags = () => [...tags.values()].filter((t) => !scope || t.path === scope || t.path.startsWith(`${scope}/`));

  const offline = () => {
    const list = scopedTags();
    if (!list.length) return toast('No tags in that folder', 'warning');
    const { width, height } = PAGE_SIZES[size];
    applyGenerated(generateFromTags(list, { title: doc?.title ?? scope.split('/').pop() ?? 'Overview', width, height, scope }));
    onClose();
  };

  const ai = async () => {
    setBusy(true);
    try {
      const { width, height } = PAGE_SIZES[size];
      const result = await api.post<Omit<DisplayDoc, 'name'>>('/ai/generate', {
        prompt, width, height, catalog: catalogForAi(),
        tags: scopedTags().slice(0, 400).map((t) => ({ path: t.path, dataType: t.dataType, unit: t.unit, writable: t.writable, min: t.min, max: t.max, states: t.states })),
        current: improve && doc ? doc : undefined,
      });
      applyGenerated(result);
      onClose();
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={<><Sparkles size={16} /> AI page assistant</>} onClose={onClose} width="min(720px, 98vw)"
      footer={<>
        <button onClick={offline} disabled={busy} title="Free, offline: builds the page from tag names, types and units"><Wand2 size={14} /> Auto-generate from tags (offline)</button>
        <span className="spacer" />
        <button className="primary" onClick={() => void ai()} disabled={busy || !status?.enabled || !prompt.trim()}>
          <Sparkles size={14} /> {busy ? 'Designing… (up to a minute)' : 'Generate with AI'}
        </button>
      </>}>
      <div className="form ai-form">
        <label>Describe the page
          <textarea rows={4} value={prompt} placeholder="e.g. Overview of the pump station with the wet well, three pumps, gauges, a trend and the alarm list" onChange={(e) => setPrompt(e.target.value)} />
        </label>
        <div className="chips">{EXAMPLES.map((x) => <button key={x} className="chip-btn" onClick={() => setPrompt(x)}>{x}</button>)}</div>
        <div className="grid2-inline">
          <label>Tags to use (folder)<TagPicker allowFolders value={scope} placeholder="(all tags) e.g. Sites/PumpStation" onChange={setScope} /></label>
          <label>Page size
            <select value={size} onChange={(e) => setSize(e.target.value as PageSize)}>
              {(['desktop', 'tablet', 'phone'] as PageSize[]).map((s) => <option key={s} value={s}>{PAGE_SIZES[s].label} ({PAGE_SIZES[s].width}×{PAGE_SIZES[s].height})</option>)}
            </select>
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} /> Improve the current page instead of starting from scratch (AI)</label>
        <div className={`ai-status ${status?.enabled ? 'on' : ''}`}>
          {status?.enabled
            ? <>AI connected: <b>{status.provider}</b> · {status.model}. The result replaces the page content (undo with Ctrl+Z). Nothing is saved until you press Save.</>
            : <>No AI provider configured — <b>Auto-generate from tags</b> works without one. To enable free AI, start the server with
              <code>NEXUS_AI_PROVIDER=gemini NEXUS_AI_KEY=…</code> (free key at aistudio.google.com), or <code>groq</code> / <code>openrouter</code>, or fully local
              <code>NEXUS_AI_PROVIDER=ollama</code>. See the User Guide.</>}
        </div>
      </div>
    </Modal>
  );
}
