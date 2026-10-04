import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOps, diffDocs } from '../../shared/designOps.ts';
import { SERVER_GLOBALS } from '../../shared/script-api.ts';
import { compileScript, extractTagRefs } from '../../shared/scriptCompiler.ts';
import { installTemplate, TEMPLATES } from '../../shared/templates/index.ts';
import type { DisplayDoc, ElementDoc } from '../../shared/types.ts';
import { validateProject, walkNodes } from '../src/config/validation.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { TagEngine } from '../src/tags/TagEngine.ts';

/** Every element type registered by the client (client/src/graphics/elements). */
const ELEMENT_TYPES = new Set([
  'rect', 'ellipse', 'line', 'text', 'image', 'pipe', 'group', 'tank', 'silo', 'pump', 'valve', 'motor', 'fan', 'compressor', 'conveyor',
  'heatExchanger', 'boiler', 'instrument', 'cylinder3d', 'cube3d', 'sphere3d', 'cone3d', 'lamp', 'thermostat', 'door', 'solar', 'battery',
  'plug', 'house', 'beacon', 'button', 'switch', 'slider', 'numeric', 'textInput', 'dropdown', 'checkbox', 'gauge', 'bar', 'led', 'value',
  'multistate', 'progress', 'clock', 'trend', 'sparkline', 'barChart', 'alarmTable', 'iframe', 'scene3d',
]);

function referencedTags(el: ElementDoc): string[] {
  const out: string[] = [];
  if (typeof el.props.tag === 'string' && el.props.tag) out.push(el.props.tag);
  if (typeof el.props.tags === 'string' && el.props.tags) out.push(...el.props.tags.split(','));
  if (el.props.action === 'faceplate' || el.props.action === 'navigate' || el.props.action === 'scene') { /* targets are folders/displays */ }
  for (const b of Object.values(el.bindings ?? {})) {
    if (b.tag) out.push(b.tag);
    if (b.expr) out.push(...extractTagRefs(b.expr));
  }
  for (const code of Object.values(el.events ?? {})) if (code) out.push(...extractTagRefs(code));
  return out;
}

describe('page templates & use cases', () => {
  for (const tpl of TEMPLATES) {
    it(`${tpl.id} installs into a valid, self-consistent project`, () => {
      const inst = installTemplate(tpl, [], 'Sites', tpl.defaultName);
      const config = validateProject({ project: { name: 't' }, nodes: inst.nodes });
      const paths = new Set<string>();
      walkNodes(config.nodes, (n, path) => { if (n.kind === 'tag') paths.add(path); });

      // displays only use known element types, unique ids and existing tags
      const ids = new Set<string>();
      for (const el of inst.display.elements) {
        assert.ok(ELEMENT_TYPES.has(el.type), `unknown element type ${el.type}`);
        assert.ok(!ids.has(el.id), `duplicate id ${el.id}`);
        ids.add(el.id);
        assert.ok(el.x >= 0 && el.y >= 0 && el.x + el.w <= inst.display.width + 1 && el.y + el.h <= inst.display.height + 1, `${el.id} outside the page`);
        for (const t of referencedTags(el)) assert.ok(paths.has(t), `${el.id} references missing tag ${t}`);
      }

      // calculated tags compile and only depend on existing tags
      const engine = new TagEngine(new EventBus());
      engine.load(config.nodes);
      for (const rt of engine.all()) {
        if (!rt.def.expression) continue;
        assert.ok(rt.expression, `${rt.path} expression does not compile`);
        for (const d of rt.expression!.deps) assert.ok(paths.has(d), `${rt.path} depends on missing ${d}`);
      }

      // scripts compile with the server script API
      for (const s of inst.scripts) {
        assert.doesNotThrow(() => compileScript(s.code, SERVER_GLOBALS), `${s.name} does not compile`);
        for (const t of extractTagRefs(s.code)) assert.ok(paths.has(t), `${s.name} references missing ${t}`);
      }
    });
  }

  it('rejects name clashes', () => {
    const tpl = TEMPLATES[0];
    const first = installTemplate(tpl, [], 'Sites', 'A');
    assert.throws(() => installTemplate(tpl, first.nodes, 'Sites', 'A'), /already exists/);
  });
});

describe('collaborative design operations', () => {
  const doc = (els: Partial<ElementDoc>[]): DisplayDoc => ({
    name: 'd', width: 100, height: 100, elements: els.map((e, i) => ({ id: `e${i}`, type: 'rect', x: 0, y: 0, w: 10, h: 10, props: {}, ...e })),
  });

  it('diff + apply reproduces the target document', () => {
    const a = doc([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const b: DisplayDoc = { ...a, background: '#000', elements: [{ ...a.elements[2], x: 50 }, a.elements[0], { id: 'n', type: 'text', x: 1, y: 1, w: 5, h: 5, props: {} }] };
    const ops = diffDocs(a, b);
    assert.deepEqual(applyOps(a, ops), b);
  });

  it('concurrent edits on different elements converge', () => {
    const base = doc([{ id: 'a' }, { id: 'b' }]);
    const u1 = diffDocs(base, { ...base, elements: [{ ...base.elements[0], x: 30 }, base.elements[1]] });
    const u2 = diffDocs(base, { ...base, elements: [base.elements[0], { ...base.elements[1], y: 40 }] });
    const server = applyOps(applyOps(base, u1), u2);
    const client1 = applyOps(applyOps(base, u1), u2);
    const client2 = applyOps(applyOps(base, u2), u1);
    assert.deepEqual(client1, server);
    assert.deepEqual(client2.elements.find((e) => e.id === 'a')!.x, 30);
    assert.deepEqual(client2.elements.find((e) => e.id === 'b')!.y, 40);
  });
});
