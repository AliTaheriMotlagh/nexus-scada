import type { SceneObjectType } from '@shared/types.ts';

/** 3D object catalogue (kept free of three.js imports so it can live in the main bundle). */
export interface ObjectTypeInfo { type: SceneObjectType; label: string; props: Record<string, unknown>; primary?: string }

/** Palette of 3D object types with default props. */
export const OBJECT_TYPES: ObjectTypeInfo[] = [
  { type: 'tank', label: 'Tank', props: { level: 50, fillColor: '#38bdf8', showLabel: true }, primary: 'level' },
  { type: 'pump', label: 'Pump', props: { running: false, speed: 50 }, primary: 'running' },
  { type: 'pipe', label: 'Pipe', props: { color: '#94a3b8', flowing: false, flowColor: '#38bdf8' }, primary: 'flowing' },
  { type: 'valve', label: 'Valve', props: { open: false }, primary: 'open' },
  { type: 'motor', label: 'Motor', props: { running: false }, primary: 'running' },
  { type: 'fan', label: 'Fan', props: { running: false }, primary: 'running' },
  { type: 'conveyor', label: 'Conveyor', props: { running: false }, primary: 'running' },
  { type: 'house', label: 'House', props: { color: '#e2e8f0', roofColor: '#b91c1c', lit: false }, primary: 'lit' },
  { type: 'lamp', label: 'Lamp', props: { on: false, color: '#fde047', intensity: 4 }, primary: 'on' },
  { type: 'box', label: 'Box', props: { color: '#64748b' }, primary: 'color' },
  { type: 'cylinder', label: 'Cylinder', props: { color: '#64748b' }, primary: 'color' },
  { type: 'sphere', label: 'Sphere', props: { color: '#f43f5e' }, primary: 'color' },
  { type: 'cone', label: 'Cone', props: { color: '#f59e0b' }, primary: 'color' },
  { type: 'torus', label: 'Torus', props: { color: '#a78bfa' }, primary: 'color' },
  { type: 'plane', label: 'Floor plane', props: { color: '#1e293b' }, primary: 'color' },
  { type: 'label', label: 'Label', props: { text: 'Label', showLabel: true }, primary: 'value' },
  { type: 'model', label: 'glTF model', props: { url: '' } },
  { type: 'pointLight', label: 'Point light', props: { color: '#ffffff', intensity: 5, distance: 10 } },
];
