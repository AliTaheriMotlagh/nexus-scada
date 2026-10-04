import { memo } from 'react';
import type { DisplayDoc } from '@shared/types.ts';
import { ElementView } from '../ElementView.tsx';

/** Static, scaled thumbnail of a display (design props only, no live data). */
export const DocPreview = memo(function DocPreview({ doc, width }: { doc: Omit<DisplayDoc, 'name'>; width: number }) {
  const scale = width / doc.width;
  return (
    <div className="doc-preview" style={{ width, height: Math.round(doc.height * scale) }}>
      <div className="display-canvas design" style={{ width: doc.width, height: doc.height, transform: `scale(${scale})`, background: doc.background ?? 'var(--canvas-bg)', pointerEvents: 'none' }}>
        {doc.elements.map((el) => <ElementView key={el.id} el={el} mode="design" />)}
      </div>
    </div>
  );
});
