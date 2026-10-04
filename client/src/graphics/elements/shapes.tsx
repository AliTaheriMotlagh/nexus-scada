import { register, num, str, bool, shade, useSvgId as svgId, type RenderContext } from '../registry.ts';

function Rect({ props: p }: RenderContext) {
  const fill = str(p.fill, '#1e293b');
  return (
    <div
      className="shape"
      style={{
        background: bool(p.gradient) ? `linear-gradient(180deg, ${shade(fill, 18)}, ${shade(fill, -22)})` : fill,
        border: `${num(p.strokeWidth, 1)}px solid ${str(p.stroke, '#334155')}`,
        borderRadius: num(p.radius, 4),
        boxShadow: bool(p.shadow) ? '0 6px 18px rgba(0,0,0,.35)' : undefined,
      }}
    />
  );
}

function Ellipse({ props: p }: RenderContext) {
  return <div className="shape" style={{ background: str(p.fill, '#1e293b'), border: `${num(p.strokeWidth, 1)}px solid ${str(p.stroke, '#334155')}`, borderRadius: '50%' }} />;
}

function Line({ props: p }: RenderContext) {
  const id = svgId();
  const sw = num(p.strokeWidth, 2);
  return (
    <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 10" overflow="visible">
      <defs>
        <marker id={`${id}a`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L8,4 L0,8 z" fill={str(p.stroke, '#94a3b8')} />
        </marker>
      </defs>
      <line x1="0" y1="5" x2="100" y2="5" stroke={str(p.stroke, '#94a3b8')} strokeWidth={sw} vectorEffect="non-scaling-stroke"
        strokeDasharray={bool(p.dashed) ? '6 4' : undefined} markerEnd={bool(p.arrow) ? `url(#${id}a)` : undefined} />
    </svg>
  );
}

function Text({ props: p }: RenderContext) {
  const align = str(p.align, 'left');
  return (
    <div className="shape-text" style={{
      color: str(p.color, '#e2e8f0'), fontSize: num(p.fontSize, 16), fontWeight: str(p.fontWeight, '400') as never,
      justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      textAlign: align as never, background: str(p.background, 'transparent'), fontFamily: bool(p.mono) ? 'var(--mono)' : undefined,
    }}>
      {str(p.text, 'Text')}
    </div>
  );
}

function Image({ props: p }: RenderContext) {
  return p.src
    ? <img src={str(p.src)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: str(p.fit, 'contain') as never }} />
    : <div className="placeholder">Image</div>;
}

/** 3D-shaded pipe with animated flow. Rotate the element for vertical runs. */
function Pipe({ props: p }: RenderContext) {
  const id = svgId();
  const color = str(p.color, '#64748b');
  const flowing = bool(p.flowing);
  return (
    <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 20">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade(color, -45)} />
          <stop offset="0.35" stopColor={shade(color, 45)} />
          <stop offset="0.6" stopColor={color} />
          <stop offset="1" stopColor={shade(color, -55)} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="100" height="20" fill={`url(#${id}g)`} />
      {flowing && (
        <line x1="0" y1="10" x2="100" y2="10" stroke={str(p.flowColor, '#7dd3fc')} strokeWidth="4" strokeLinecap="round"
          strokeDasharray="6 10" vectorEffect="non-scaling-stroke"
          className={`flow ${str(p.direction, 'right') === 'left' ? 'reverse' : ''}`} style={{ animationDuration: `${num(p.speed, 1)}s` }} />
      )}
    </svg>
  );
}

function Group() {
  return null; // children are rendered by ElementView
}

register(
  {
    type: 'rect', label: 'Rectangle', category: 'Shapes', w: 160, h: 100, Component: Rect,
    props: [
      { name: 'fill', type: 'color', default: '#1e293b', group: 'Appearance' },
      { name: 'stroke', type: 'color', default: '#334155', group: 'Appearance' },
      { name: 'strokeWidth', type: 'number', default: 1, min: 0, group: 'Appearance' },
      { name: 'radius', type: 'number', default: 6, min: 0, group: 'Appearance' },
      { name: 'gradient', type: 'boolean', default: false, group: 'Appearance' },
      { name: 'shadow', type: 'boolean', default: false, group: 'Appearance' },
    ],
    primary: 'fill',
  },
  {
    type: 'ellipse', label: 'Ellipse', category: 'Shapes', w: 100, h: 100, Component: Ellipse, primary: 'fill',
    props: [
      { name: 'fill', type: 'color', default: '#1e293b' },
      { name: 'stroke', type: 'color', default: '#334155' },
      { name: 'strokeWidth', type: 'number', default: 1, min: 0 },
    ],
  },
  {
    type: 'line', label: 'Line / Arrow', category: 'Shapes', w: 160, h: 10, Component: Line, primary: 'stroke',
    props: [
      { name: 'stroke', type: 'color', default: '#94a3b8' },
      { name: 'strokeWidth', type: 'number', default: 2, min: 1 },
      { name: 'dashed', type: 'boolean', default: false },
      { name: 'arrow', type: 'boolean', default: false },
    ],
  },
  {
    type: 'text', label: 'Text', category: 'Shapes', w: 160, h: 32, Component: Text, primary: 'text',
    props: [
      { name: 'text', type: 'text', default: 'Text', group: 'Data' },
      { name: 'color', type: 'color', default: '#e2e8f0' },
      { name: 'fontSize', type: 'number', default: 16, min: 6 },
      { name: 'fontWeight', type: 'select', options: ['300', '400', '500', '600', '700', '800'], default: '400' },
      { name: 'align', type: 'select', options: ['left', 'center', 'right'], default: 'left' },
      { name: 'background', type: 'color', default: 'transparent' },
      { name: 'mono', type: 'boolean', default: false },
    ],
  },
  {
    type: 'image', label: 'Image', category: 'Shapes', w: 160, h: 120, Component: Image,
    props: [
      { name: 'src', type: 'url', default: '' },
      { name: 'fit', type: 'select', options: ['contain', 'cover', 'fill'], default: 'contain' },
    ],
  },
  {
    type: 'pipe', label: 'Pipe (flow)', category: 'Process', w: 200, h: 18, Component: Pipe, primary: 'flowing',
    props: [
      { name: 'color', type: 'color', default: '#64748b' },
      { name: 'flowing', type: 'boolean', default: false, group: 'Data' },
      { name: 'flowColor', type: 'color', default: '#7dd3fc' },
      { name: 'direction', type: 'select', options: ['right', 'left'], default: 'right' },
      { name: 'speed', type: 'number', default: 1, min: 0.1, step: 0.1, help: 'Seconds per cycle (lower = faster)' },
    ],
  },
  { type: 'group', label: 'Group', category: 'Shapes', w: 100, h: 100, Component: Group, props: [] },
);
