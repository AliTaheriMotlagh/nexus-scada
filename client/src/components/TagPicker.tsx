import { useState } from 'react';
import { Search, Tags } from 'lucide-react';
import { useProject } from '../stores/project.ts';
import { Popover } from './Overlays.tsx';
import { Tree } from './Tree.tsx';

/** Text input with a tree popover for choosing a tag path (or typing one, incl. {$param} templates). */
export function TagPicker({ value, onChange, placeholder = 'Tag path', allowFolders }: {
  value: string; onChange: (path: string) => void; placeholder?: string; allowFolders?: boolean;
}) {
  const tree = useProject((s) => s.tree);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  return (
    <div className="tag-picker">
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} list="nexus-tag-list" />
      <button className="icon-btn" title="Browse tags" onClick={() => setOpen(!open)}><Tags size={15} /></button>
      <Popover open={open} onClose={() => setOpen(false)} className="tag-popover">
        <div className="search"><Search size={14} /><input autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="tag-popover-tree">
          <Tree
            items={tree}
            filter={filter}
            selected={value}
            defaultDepth={2}
            onSelect={(it) => { if (!it.children || allowFolders) { onChange(it.id); if (!it.children) setOpen(false); } }}
            onActivate={(it) => { onChange(it.id); setOpen(false); }}
          />
        </div>
      </Popover>
    </div>
  );
}

/** Shared <datalist> of all tags for quick typing with autocomplete. */
export function TagDatalist() {
  const tags = useProject((s) => s.tags);
  return <datalist id="nexus-tag-list">{[...tags.keys()].map((p) => <option key={p} value={p} />)}</datalist>;
}
