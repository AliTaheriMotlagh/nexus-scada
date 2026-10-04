import { Download, Trash2, Upload } from 'lucide-react';
import type { RecipeConfig } from '@shared/types.ts';
import { Empty } from '../components/Overlays.tsx';
import { useTagValues } from '../hooks/useTags.ts';
import { api } from '../lib/api.ts';
import { formatValue } from '../lib/format.ts';
import { useProject } from '../stores/project.ts';
import { useHasRole } from '../stores/session.ts';
import { errorToast, toast, useUi } from '../stores/ui.ts';

function RecipeCard({ r }: { r: RecipeConfig }) {
  const get = useTagValues(r.tags);
  const tags = useProject((s) => s.tags);
  const canRun = useHasRole('operator');
  const canEdit = useHasRole('engineer');
  const sets = Object.keys(r.sets);
  const download = async (set: string) => {
    if (!(await useUi.getState().confirm(`Download recipe "${r.name} / ${set}" to the process?`))) return;
    try {
      await api.post(`/recipes/${encodeURIComponent(r.name)}/download`, { set });
      toast(`Recipe ${set} downloaded`, 'success');
    } catch (err) { errorToast(err); }
  };
  const upload = async () => {
    const set = await useUi.getState().prompt('Save current values as recipe set:', 'NewSet');
    if (!set) return;
    try {
      await api.post(`/recipes/${encodeURIComponent(r.name)}/upload`, { set });
      await useProject.getState().refresh();
      toast(`Set ${set} captured`, 'success');
    } catch (err) { errorToast(err); }
  };
  const remove = async (set: string) => {
    if (!(await useUi.getState().confirm(`Delete set ${set}?`))) return;
    try {
      await api.del(`/recipes/${encodeURIComponent(r.name)}/sets/${encodeURIComponent(set)}`);
      await useProject.getState().refresh();
    } catch (err) { errorToast(err); }
  };
  return (
    <div className="card">
      <div className="card-head"><b>{r.name}</b><span className="muted">{r.description}</span><span className="spacer" />
        {canEdit && <button onClick={() => void upload()}><Upload size={14} /> Capture current</button>}</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Tag</th><th>Live</th>{sets.map((s) => (
              <th key={s}>{s}
                {canRun && <button className="icon-btn" title="Download to process" onClick={() => void download(s)}><Download size={13} /></button>}
                {canEdit && <button className="icon-btn" title="Delete set" onClick={() => void remove(s)}><Trash2 size={13} /></button>}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {r.tags.map((t) => (
              <tr key={t}>
                <td className="mono">{t}</td>
                <td className="mono">{formatValue(get(t)?.value, tags.get(t))}</td>
                {sets.map((s) => <td key={s} className={`mono ${String(r.sets[s][t]) === String(get(t)?.value) ? 'match' : ''}`}>{String(r.sets[s][t] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RecipesPage() {
  const recipes = useProject((s) => s.recipes);
  return (
    <div className="page">
      <main className="content">
        <div className="content-head"><h2>Recipes</h2><span className="muted small">Download parameter sets to the process, or capture live values as a new set</span></div>
        <div className="content-body padded scroll">
          {recipes.map((r) => <RecipeCard key={r.name} r={r} />)}
          {!recipes.length && <Empty>No recipes. Add a <code>recipes:</code> section to project.yaml.</Empty>}
        </div>
      </main>
    </div>
  );
}
