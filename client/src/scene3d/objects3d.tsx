import { Suspense, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, RoundedBox, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { SceneObject, SceneObjectType } from '@shared/types.ts';

type P = Record<string, any>;
const bool = (v: unknown) => v === true || v === 1 || v === 'true';
const num = (v: unknown, d: number) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const runColor = (p: P) => (bool(p.fault) ? '#ef4444' : bool(p.running) ? (p.onColor ?? '#22c55e') : (p.offColor ?? '#64748b'));

function Mat({ color, metal = 0.3, rough = 0.5, emissive, opacity, highlight }: { color: string; metal?: number; rough?: number; emissive?: string; opacity?: number; highlight?: boolean }) {
  return (
    <meshStandardMaterial color={color} metalness={metal} roughness={rough}
      emissive={highlight ? '#38bdf8' : emissive ?? '#000000'} emissiveIntensity={highlight ? 0.35 : emissive ? 0.9 : 0}
      transparent={opacity !== undefined && opacity < 1} opacity={opacity ?? 1} />
  );
}

/** Spinning group for rotating machinery. */
function Spinner({ running, speed = 6, axis = 'y', children }: { running: boolean; speed?: number; axis?: 'x' | 'y' | 'z'; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (running && ref.current) ref.current.rotation[axis] += dt * speed; });
  return <group ref={ref}>{children}</group>;
}

function Tank3D({ p, hl }: { p: P; hl: boolean }) {
  const level = Math.min(100, Math.max(0, num(p.level, 50))) / 100;
  const h = 2;
  return (
    <group>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, h, 48, 1, true]} />
        <meshPhysicalMaterial color={p.shellColor ?? '#cbd5e1'} metalness={0.6} roughness={0.25} transparent opacity={0.35} side={THREE.DoubleSide}
          emissive={hl ? '#38bdf8' : '#000'} emissiveIntensity={hl ? 0.3 : 0} />
      </mesh>
      {level > 0.001 && (
        <mesh position={[0, -h / 2 + (h * level) / 2, 0]}>
          <cylinderGeometry args={[0.58, 0.58, h * level, 48]} />
          <meshStandardMaterial color={p.fillColor ?? '#38bdf8'} roughness={0.15} metalness={0.1} transparent opacity={0.88} />
        </mesh>
      )}
      <mesh position={[0, h / 2, 0]} castShadow><sphereGeometry args={[0.62, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#94a3b8" metal={0.7} rough={0.3} highlight={hl} /></mesh>
      <mesh position={[0, -h / 2 - 0.05, 0]} castShadow><cylinderGeometry args={[0.64, 0.64, 0.1, 48]} /><Mat color="#64748b" metal={0.6} /></mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.5, -h / 2 - 0.35, Math.sin((i * Math.PI) / 2) * 0.5]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 0.6]} /><Mat color="#475569" metal={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Pump3D({ p, hl }: { p: P; hl: boolean }) {
  const c = runColor(p);
  return (
    <group>
      <mesh position={[0, -0.32, 0]} castShadow receiveShadow><boxGeometry args={[1.5, 0.12, 0.6]} /><Mat color="#334155" /></mesh>
      <mesh position={[-0.35, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.32, 0.32, 0.25, 32]} /><Mat color={c} metal={0.5} rough={0.35} highlight={hl} /></mesh>
      <mesh position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.22, 0.22, 0.75, 32]} /><Mat color="#475569" metal={0.6} rough={0.4} highlight={hl} /></mesh>
      <mesh position={[-0.35, 0.36, 0]} castShadow><cylinderGeometry args={[0.1, 0.1, 0.3, 16]} /><Mat color="#94a3b8" metal={0.7} /></mesh>
      <group position={[-0.49, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <Spinner running={bool(p.running)} speed={num(p.speed, 50) / 5}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0, 0, 0]}><boxGeometry args={[0.04, 0.02, 0.5]} /><Mat color="#e2e8f0" /></mesh>
          ))}
        </Spinner>
      </group>
    </group>
  );
}

/** Pipe along X (length = scale.x). Moving particles show flow. */
function Pipe3D({ p, hl }: { p: P; hl: boolean }) {
  const flowing = bool(p.flowing);
  const dots = useRef<THREE.Group>(null);
  const dir = p.direction === 'left' ? -1 : 1;
  useFrame((_, dt) => {
    if (!flowing || !dots.current) return;
    for (const m of dots.current.children) {
      m.position.x += dt * 0.6 * dir * num(p.speed, 1);
      if (m.position.x > 0.5) m.position.x -= 1;
      if (m.position.x < -0.5) m.position.x += 1;
    }
  });
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 1, 20, 1, true]} />
        <meshStandardMaterial color={p.color ?? '#94a3b8'} metalness={0.7} roughness={0.3} transparent opacity={flowing ? 0.55 : 1} side={THREE.DoubleSide}
          emissive={hl ? '#38bdf8' : '#000'} emissiveIntensity={hl ? 0.35 : 0} />
      </mesh>
      {flowing && (
        <group ref={dots}>
          {Array.from({ length: 8 }, (_, i) => (
            <mesh key={i} position={[-0.5 + i / 8, 0, 0]} scale={[0.6, 1, 1]}><sphereGeometry args={[0.045, 10, 10]} /><meshStandardMaterial color={p.flowColor ?? '#38bdf8'} emissive={p.flowColor ?? '#38bdf8'} emissiveIntensity={0.8} /></mesh>
          ))}
        </group>
      )}
    </group>
  );
}

function Valve3D({ p, hl }: { p: P; hl: boolean }) {
  const c = bool(p.open) ? (p.openColor ?? '#22c55e') : (p.closedColor ?? '#dc2626');
  return (
    <group>
      <mesh position={[-0.2, 0, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow><coneGeometry args={[0.22, 0.4, 24]} /><Mat color={c} highlight={hl} /></mesh>
      <mesh position={[0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow><coneGeometry args={[0.22, 0.4, 24]} /><Mat color={c} highlight={hl} /></mesh>
      <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.03, 0.03, 0.5]} /><Mat color="#94a3b8" metal={0.8} /></mesh>
      <mesh position={[0, 0.52, 0]} castShadow><cylinderGeometry args={[0.2, 0.2, 0.12, 24]} /><Mat color={c} highlight={hl} /></mesh>
    </group>
  );
}

function Motor3D({ p, hl }: { p: P; hl: boolean }) {
  const c = runColor(p);
  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[0.3, 0.3, 0.9, 32]} /><Mat color={c} metal={0.5} rough={0.35} highlight={hl} /></mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} position={[-0.35 + i * 0.1, 0, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.31, 0.015, 6, 32]} /><Mat color="#1e293b" /></mesh>
      ))}
      <mesh position={[0.52, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.05, 0.05, 0.2]} /><Mat color="#e2e8f0" metal={0.9} /></mesh>
      <mesh position={[0, 0.34, 0]}><boxGeometry args={[0.25, 0.12, 0.2]} /><Mat color={c} /></mesh>
    </group>
  );
}

function Fan3D({ p, hl }: { p: P; hl: boolean }) {
  return (
    <group>
      <mesh><torusGeometry args={[0.5, 0.05, 12, 48]} /><Mat color="#475569" highlight={hl} /></mesh>
      <Spinner running={bool(p.running)} speed={8} axis="z">
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0.4, 0, (i * Math.PI) / 2]} position={[Math.cos((i * Math.PI) / 2) * 0.22, Math.sin((i * Math.PI) / 2) * 0.22, 0]}>
            <boxGeometry args={[0.4, 0.14, 0.02]} /><Mat color={runColor(p)} />
          </mesh>
        ))}
      </Spinner>
    </group>
  );
}

function Conveyor3D({ p, hl }: { p: P; hl: boolean }) {
  const boxes = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!bool(p.running) || !boxes.current) return;
    for (const b of boxes.current.children) {
      b.position.x += dt * 0.4;
      if (b.position.x > 1) b.position.x = -1;
    }
  });
  return (
    <group>
      <RoundedBox args={[2.2, 0.08, 0.6]} radius={0.04} castShadow receiveShadow><Mat color="#1e293b" highlight={hl} /></RoundedBox>
      {[-1, -0.5, 0, 0.5, 1].map((x) => <mesh key={x} position={[x, -0.08, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.06, 0.06, 0.62, 16]} /><Mat color="#94a3b8" metal={0.8} /></mesh>)}
      <group ref={boxes}>{[-0.8, -0.1, 0.6].map((x) => <mesh key={x} position={[x, 0.16, 0]} castShadow><boxGeometry args={[0.24, 0.22, 0.24]} /><Mat color="#b45309" rough={0.8} /></mesh>)}</group>
    </group>
  );
}

function House3D({ p, hl }: { p: P; hl: boolean }) {
  const lit = bool(p.lit);
  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow><boxGeometry args={[2, 1, 1.6]} /><Mat color={p.color ?? '#e2e8f0'} rough={0.8} highlight={hl} /></mesh>
      <mesh position={[0, 1.35, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[1.5, 0.7, 4]} /><Mat color={p.roofColor ?? '#b91c1c'} rough={0.7} /></mesh>
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.6, 0.81]}><planeGeometry args={[0.4, 0.35]} /><meshStandardMaterial color={lit ? '#fde047' : '#1e293b'} emissive={lit ? '#fde047' : '#000'} emissiveIntensity={lit ? 1.2 : 0} /></mesh>
      ))}
      <mesh position={[0, 0.3, 0.81]}><planeGeometry args={[0.35, 0.6]} /><Mat color="#78350f" /></mesh>
    </group>
  );
}

function Lamp3D({ p, hl }: { p: P; hl: boolean }) {
  const on = bool(p.on);
  const color = p.color ?? '#fde047';
  return (
    <group>
      <mesh><sphereGeometry args={[0.18, 24, 24]} /><meshStandardMaterial color={on ? color : '#64748b'} emissive={on ? color : hl ? '#38bdf8' : '#000'} emissiveIntensity={on ? 2 : hl ? 0.4 : 0} /></mesh>
      <mesh position={[0, 0.22, 0]}><cylinderGeometry args={[0.08, 0.1, 0.12, 16]} /><Mat color="#94a3b8" metal={0.8} /></mesh>
      {on && <pointLight color={color} intensity={num(p.intensity, 4)} distance={6} castShadow />}
    </group>
  );
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  const copy = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={copy} />;
}

function Primitive({ type, p, hl }: { type: SceneObjectType; p: P; hl: boolean }) {
  const color = p.color ?? '#94a3b8';
  const geo = (() => {
    switch (type) {
      case 'box': return <boxGeometry args={[1, 1, 1]} />;
      case 'cylinder': return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
      case 'sphere': return <sphereGeometry args={[0.5, 32, 32]} />;
      case 'cone': return <coneGeometry args={[0.5, 1, 32]} />;
      case 'torus': return <torusGeometry args={[0.4, 0.12, 16, 48]} />;
      default: return <planeGeometry args={[1, 1]} />;
    }
  })();
  return (
    <mesh castShadow receiveShadow rotation={type === 'plane' ? [-Math.PI / 2, 0, 0] : undefined}>
      {geo}
      <Mat color={color} metal={num(p.metalness, 0.2)} rough={num(p.roughness, 0.6)} opacity={num(p.opacity, 1)} emissive={bool(p.glow) ? color : undefined} highlight={hl} />
    </mesh>
  );
}

/** Renders a scene object by type (factory). */
export function Object3D({ obj, p, highlight }: { obj: SceneObject; p: P; highlight: boolean }) {
  switch (obj.type) {
    case 'tank': return <Tank3D p={p} hl={highlight} />;
    case 'pump': return <Pump3D p={p} hl={highlight} />;
    case 'pipe': return <Pipe3D p={p} hl={highlight} />;
    case 'valve': return <Valve3D p={p} hl={highlight} />;
    case 'motor': return <Motor3D p={p} hl={highlight} />;
    case 'fan': return <Fan3D p={p} hl={highlight} />;
    case 'conveyor': return <Conveyor3D p={p} hl={highlight} />;
    case 'house': return <House3D p={p} hl={highlight} />;
    case 'lamp': return <Lamp3D p={p} hl={highlight} />;
    case 'pointLight': return <pointLight color={p.color ?? '#ffffff'} intensity={num(p.intensity, 5)} distance={num(p.distance, 10)} />;
    case 'label': return null;
    case 'model': return p.url ? <Suspense fallback={null}><Model url={String(p.url)} /></Suspense> : <Primitive type="box" p={p} hl={highlight} />;
    default: return <Primitive type={obj.type} p={p} hl={highlight} />;
  }
}

/** Floating HTML label (always readable). */
export function Label3D({ text, sub, color }: { text: string; sub?: string; color?: string }) {
  return (
    <Html center distanceFactor={8} zIndexRange={[10, 0]}>
      <div className="label3d" style={{ borderColor: color }}>
        <div className="l3-title">{text}</div>
        {sub && <div className="l3-value">{sub}</div>}
      </div>
    </Html>
  );
}
