import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, Environment, Grid, Lightformer, OrbitControls, TransformControls } from '@react-three/drei';
import type * as THREE from 'three';
import type { SceneDoc, SceneObject, Vec3 } from '@shared/types.ts';
import { useTagValues } from '../hooks/useTags.ts';
import { formatValue } from '../lib/format.ts';
import { bindingTagRefs, resolveProps, type Getter } from '../scripting/bindings.ts';
import { runClientScript } from '../scripting/clientScriptApi.ts';
import { useProject } from '../stores/project.ts';
import { useUi } from '../stores/ui.ts';
import { Label3D, Object3D } from './objects3d.tsx';

export type TransformMode = 'translate' | 'rotate' | 'scale';

interface Props {
  doc: SceneDoc;
  mode: 'runtime' | 'design';
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onTransform?: (id: string, patch: { position: Vec3; rotation: Vec3; scale: Vec3 }) => void;
  transformMode?: TransformMode;
  autoRotate?: boolean;
}

const r2 = (v: number) => Math.round(v * 1000) / 1000;

function SceneObjectNode({ obj, get, mode, selected, hovered, setHovered, onSelect, onTransform, transformMode }: {
  obj: SceneObject; get: Getter; mode: Props['mode']; selected: boolean; hovered: boolean; setHovered: (id: string | null) => void;
  onSelect?: Props['onSelect']; onTransform?: Props['onTransform']; transformMode: TransformMode;
}) {
  const group = useRef<THREE.Group>(null!);
  const p = resolveProps(obj as never, get);
  const tags = useProject((s) => s.tags);
  const runtime = mode === 'runtime';
  const clickable = runtime && (!!obj.events?.click || !!obj.faceplate?.path);
  const labelTag = obj.bindings ? Object.values(obj.bindings).find((b) => b.tag)?.tag : undefined;
  const labelValue = labelTag ? formatValue(get(labelTag)?.value, tags.get(labelTag)) : undefined;

  const node = (
    <group
      ref={group}
      position={obj.position}
      rotation={obj.rotation}
      scale={obj.scale}
      visible={p.visible === undefined ? true : Boolean(p.visible)}
      onClick={(e) => {
        e.stopPropagation();
        if (!runtime) return onSelect?.(obj.id);
        if (obj.events?.click) void runClientScript(obj.events.click, { event: { type: 'click', object: obj.id }, source: `scene/${obj.name ?? obj.id}.click` });
        if (obj.faceplate?.path) useUi.getState().openFaceplate(obj.faceplate.path, obj.faceplate.display);
      }}
      onPointerOver={(e) => { e.stopPropagation(); if (clickable || !runtime) { setHovered(obj.id); document.body.style.cursor = 'pointer'; } }}
      onPointerOut={() => { setHovered(null); document.body.style.cursor = ''; }}
    >
      <Object3D obj={obj} p={p} highlight={selected || hovered} />
      {(p.showLabel || obj.type === 'label') && (
        <group position={[0, Number(p.labelHeight ?? (obj.type === 'tank' ? 1.75 : 0.9)) / Math.max(0.01, obj.scale[1]), 0]}>
          <Label3D text={String(p.text ?? obj.name ?? obj.type)} sub={p.value !== undefined && obj.type === 'label' ? String(p.value) : labelValue} />
        </group>
      )}
    </group>
  );

  if (!runtime && selected) {
    return (
      <TransformControls
        mode={transformMode}
        object={group}
        onMouseUp={() => {
          const g = group.current;
          onTransform?.(obj.id, {
            position: [r2(g.position.x), r2(g.position.y), r2(g.position.z)],
            rotation: [r2(g.rotation.x), r2(g.rotation.y), r2(g.rotation.z)],
            scale: [r2(g.scale.x), r2(g.scale.y), r2(g.scale.z)],
          });
        }}
      >
        {node}
      </TransformControls>
    );
  }
  return node;
}

/** Live 3D scene. Runtime: click objects for faceplates/scripts. Design: select + transform gizmo. */
export default function SceneView({ doc, mode, selected, onSelect, onTransform, transformMode = 'translate', autoRotate }: Props) {
  const refs = useMemo(() => doc.objects.flatMap((o) => bindingTagRefs(o as never)), [doc]);
  const get = useTagValues(refs);
  const [hovered, setHovered] = useState<string | null>(null);
  const cam = doc.camera ?? { position: [6, 5, 8] as Vec3, target: [0, 0.5, 0] as Vec3, fov: 45 };
  const theme = useUi((s) => s.theme);
  const bg = doc.background ?? (theme === 'dark' ? '#0b1118' : '#e2e8f0');

  return (
    <Canvas shadows={doc.shadows !== false} camera={{ position: cam.position, fov: cam.fov ?? 45 }} dpr={[1, 2]}
      onPointerMissed={() => mode === 'design' && onSelect?.(null)} style={{ background: bg }}>
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#dbeafe', '#1e293b', 0.6]} />
      <directionalLight position={[6, 10, 6]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={12} shadow-camera-bottom={-12} />
      {doc.environment && doc.environment !== 'none' && (
        // Locally generated studio environment (no CDN download → works offline)
        <Environment resolution={256} frames={1}>
          <Lightformer intensity={2} position={[0, 5, -9]} scale={[10, 5, 1]} />
          <Lightformer intensity={1.2} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[20, 0.5, 1]} />
          <Lightformer intensity={1.2} position={[10, 1, 0]} rotation-y={-Math.PI / 2} scale={[20, 1, 1]} />
          <Lightformer form="ring" color={doc.environment === 'sunset' ? '#fb923c' : '#e0f2fe'} intensity={3} position={[0, 8, 4]} scale={4} />
        </Environment>
      )}
      <Suspense fallback={null}>
        {doc.objects.map((o) => (
          <SceneObjectNode key={o.id} obj={o} get={get} mode={mode} selected={selected === o.id} hovered={hovered === o.id}
            setHovered={setHovered} onSelect={onSelect} onTransform={onTransform} transformMode={transformMode} />
        ))}
      </Suspense>
      {doc.grid !== false && <Grid infiniteGrid cellSize={0.5} sectionSize={2.5} fadeDistance={40} cellColor={theme === 'dark' ? '#1e293b' : '#94a3b8'} sectionColor={theme === 'dark' ? '#334155' : '#64748b'} position={[0, -0.001, 0]} />}
      <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={30} blur={2.4} far={8} />
      <OrbitControls makeDefault target={cam.target} autoRotate={autoRotate} autoRotateSpeed={0.6} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
