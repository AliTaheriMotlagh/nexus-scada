import type { MouseEvent, ReactNode } from 'react';
import { useUi } from '../stores/ui.ts';

/** True when sidebars are shown as slide-in drawers (phones, tablets in portrait). */
export const isCompact = () => window.matchMedia('(max-width: 900px)').matches;

/**
 * Page sidebar. On desktop it is a regular column; on small screens it becomes a drawer
 * toggled by the floating buttons in the app shell (see App.tsx).
 */
export function Sidebar({ side = 'left', wide, className = '', children }: { side?: 'left' | 'right'; wide?: boolean; className?: string; children: ReactNode }) {
  const open = useUi((s) => s.drawer === side);
  const setDrawer = useUi((s) => s.setDrawer);
  // Choosing a leaf in a tree (display, tag, script…) closes the drawer on small screens.
  const autoClose = (e: MouseEvent) => {
    if (side !== 'left' || !open) return;
    const t = e.target as HTMLElement;
    const row = t.closest('.tree-row, .layer-row');
    if (row && !row.hasAttribute('aria-expanded') && !t.closest('.tree-chevron, input, button')) setTimeout(() => setDrawer(null), 120);
  };
  return (
    <>
      {open && <div className="drawer-backdrop" onClick={() => setDrawer(null)} />}
      <aside className={`sidebar ${side === 'right' ? 'right' : ''} ${wide ? 'wide' : ''} ${open ? 'open' : ''} ${className}`} onClick={autoClose}>
        {children}
      </aside>
    </>
  );
}
