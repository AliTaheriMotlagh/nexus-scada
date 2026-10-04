import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileExpression, compileScript, extractTagRefs, matchRule, pathMatches, resolvePath } from '../../shared/scriptCompiler.ts';
import type { ProjectNode, TagChange } from '../../shared/types.ts';
import { evaluateCondition } from '../src/alarms/AlarmEngine.ts';
import { cronMatches, parseSchedule, sunTimes } from '../src/automation/Scheduler.ts';
import { validateProject, ValidationError } from '../src/config/validation.ts';
import { EventBus } from '../src/core/EventBus.ts';
import { getJsonPath, parseDuration, renderTemplate } from '../src/core/util.ts';
import { topicMatches } from '../src/drivers/MqttDriver.ts';
import { hashPassword, verifyPassword } from '../src/security/AuthService.ts';
import { coerce, TagEngine } from '../src/tags/TagEngine.ts';

const tick = () => new Promise((r) => setImmediate(r));

describe('script compiler (shared by server & browser)', () => {
  it('strips TypeScript and supports top-level await/return', async () => {
    const js = compileScript('const x: number = await Promise.resolve(41);\nreturn x + 1;', ['a']);
    const fn = new Function(`${js}\nreturn __script__;`)();
    assert.equal(await fn(), 42);
  });
  it('compiles expressions with tag() access', () => {
    const fn = compileExpression("tag('A') * 2 + (value as number)");
    assert.equal(fn(1, () => 10, {}), 21);
  });
  it('extracts static tag references', () => {
    assert.deepEqual(extractTagRefs("tag('A/B') + tags.get(\"C\") + tags.write('D', 1)").sort(), ['A/B', 'C', 'D']);
  });
  it('resolves relative paths and wildcards', () => {
    assert.equal(resolvePath('Plant/Tank1/Pump', './Speed'), 'Plant/Tank1/Pump/Speed');
    assert.equal(resolvePath('Plant/Tank1/Pump', '../Level'), 'Plant/Tank1/Level');
    assert.ok(pathMatches('Plant/*', 'Plant/A/B'));
    assert.ok(!pathMatches('Plant/*', 'Home/A'));
  });
  it('evaluates value-map rules', () => {
    assert.ok(matchRule('>80', 81));
    assert.ok(!matchRule('>80', 80));
    assert.ok(matchRule('10..20', 15));
    assert.ok(matchRule('==true', true));
    assert.ok(matchRule('Running', 'Running'));
    assert.ok(matchRule('default', undefined));
  });
});

describe('tag engine', () => {
  const nodes: ProjectNode[] = [
    {
      kind: 'folder', name: 'P', children: [
        { kind: 'tag', name: 'A', initial: 2, writable: true, min: 0, max: 100 },
        { kind: 'tag', name: 'B', expression: "tag('./A') * 10" },
        { kind: 'tag', name: 'D', initial: 0, writable: true, deadband: 1 },
      ],
    },
  ];

  it('coerces values by data type', () => {
    assert.equal(coerce('number', '3.5'), 3.5);
    assert.equal(coerce('number', true), 1);
    assert.equal(coerce('boolean', 'ON'), true);
    assert.equal(coerce('string', 5), '5');
  });

  it('computes calculated tags and publishes batched changes', async () => {
    const bus = new EventBus();
    const engine = new TagEngine(bus);
    const seen: TagChange[] = [];
    bus.on('tag:change', (c) => seen.push(...c));
    engine.load(nodes);
    assert.equal(engine.get('P/B')?.value, 20);
    await engine.write('P/A', 5);
    await tick();
    assert.equal(engine.get('P/B')?.value, 50);
    assert.ok(seen.some((c) => c.path === 'P/B' && c.value === 50));
  });

  it('enforces limits, read-only and deadband', async () => {
    const engine = new TagEngine(new EventBus());
    engine.load(nodes);
    await assert.rejects(engine.write('P/A', 500), /above maximum/);
    await assert.rejects(engine.write('P/B', 1), /read-only/);
    assert.equal(engine.update('P/D', 0.5), false); // within deadband
    assert.equal(engine.update('P/D', 2), true);
  });
});

describe('alarm conditions', () => {
  it('applies limits with hysteresis', () => {
    const def = { kind: 'hi' as const, limit: 80, deadband: 2 };
    assert.equal(evaluateCondition(def, 81, 'good', false), true);
    assert.equal(evaluateCondition(def, 79, 'good', false), false);
    assert.equal(evaluateCondition(def, 79, 'good', true), true); // still active inside deadband
    assert.equal(evaluateCondition(def, 77, 'good', true), false);
  });
  it('handles digital and quality alarms', () => {
    assert.equal(evaluateCondition({ kind: 'on' }, true, 'good', false), true);
    assert.equal(evaluateCondition({ kind: 'off' }, true, 'good', false), false);
    assert.equal(evaluateCondition({ kind: 'quality' }, 1, 'bad', false), true);
    assert.equal(evaluateCondition({ kind: 'lo', limit: 10 }, 5, 'bad', false), false); // bad data never trips a limit
  });
});

describe('scheduler', () => {
  it('parses and matches cron expressions', () => {
    const s = parseSchedule('*/15 6-8 * * 1-5');
    assert.equal(s.kind, 'cron');
    if (s.kind !== 'cron') return;
    assert.ok(cronMatches(s, new Date(2026, 9, 5, 7, 30))); // Monday 07:30
    assert.ok(!cronMatches(s, new Date(2026, 9, 4, 7, 30))); // Sunday
    assert.ok(!cronMatches(s, new Date(2026, 9, 5, 7, 31)));
  });
  it('parses @every and solar schedules', () => {
    assert.deepEqual(parseSchedule('@every 30s'), { kind: 'every', ms: 30_000 });
    assert.deepEqual(parseSchedule('@sunset-15m'), { kind: 'sun', event: 'sunset', offsetMs: -900_000 });
    assert.throws(() => parseSchedule('* * *'));
  });
  it('computes plausible sunrise/sunset', () => {
    const { sunrise, sunset } = sunTimes(new Date(2026, 5, 21), 51.5, 0); // London midsummer
    assert.ok(sunrise && sunset);
    const dayHours = (sunset!.getTime() - sunrise!.getTime()) / 3_600_000;
    assert.ok(dayHours > 16 && dayHours < 17, `day length ${dayHours}`);
  });
});

describe('utilities, drivers & security', () => {
  it('reads JSON paths and renders templates', () => {
    assert.equal(getJsonPath({ a: { b: [{ c: 7 }] } }, 'a.b[0].c'), 7);
    assert.equal(renderTemplate('{"state":"{{value}}"}', 'ON'), '{"state":"ON"}');
    assert.equal(parseDuration('5m'), 300_000);
  });
  it('matches MQTT topic filters', () => {
    assert.ok(topicMatches('home/+/temp', 'home/kitchen/temp'));
    assert.ok(topicMatches('home/#', 'home/a/b/c'));
    assert.ok(!topicMatches('home/+/temp', 'home/kitchen/humidity'));
  });
  it('hashes and verifies passwords', () => {
    const h = hashPassword('s3cret');
    assert.ok(verifyPassword('s3cret', h));
    assert.ok(!verifyPassword('wrong', h));
  });
  it('validates project configuration', () => {
    assert.throws(() => validateProject({ project: { name: 'x' }, nodes: [{ kind: 'device', name: 'D', driver: 'nope' }] }), ValidationError);
    const ok = validateProject({ project: { name: 'x' }, nodes: [{ kind: 'tag', name: 'T' }] });
    assert.equal(ok.nodes.length, 1);
  });
});
