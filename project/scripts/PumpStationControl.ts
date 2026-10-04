// Wet-well mass balance + lead/lag pump control (runs every second)
const B = 'Sites/PumpStation';
const pumps = ['Pump1', 'Pump2', 'Pump3'].map((p) => B + '/' + p);
const level: number = tags.get(B + '/WetWellLevel');
const next = Math.min(100, Math.max(0, level + (tags.get(B + '/Inflow') - (tags.get(B + '/Outflow') ?? 0)) * 0.004));
await tags.write(B + '/WetWellLevel', Math.round(next * 10) / 10);

// a tripped pump stops immediately
for (const p of pumps) if (tags.get(p + '/Fault') && tags.get(p + '/Running')) await tags.write(p + '/Running', false);
if (tags.get(B + '/Mode') !== 'Auto') return;

const healthy = pumps.filter((p) => !tags.get(p + '/Fault'));
const running = healthy.filter((p) => tags.get(p + '/Running'));
const settled = Date.now() - (state.lastChange ?? 0) > 15000;
if (settled && next > tags.get(B + '/StartLevel') && running.length < healthy.length) {
  const idle = healthy.filter((p) => !tags.get(p + '/Running'));
  await tags.write(idle[0] + '/Running', true);
  state.lastChange = Date.now();
  log.info('Level ' + next.toFixed(1) + '% → start ' + idle[0]);
} else if (settled && next < tags.get(B + '/StopLevel') && running.length > 0) {
  await tags.write(running[running.length - 1] + '/Running', false);
  state.lastChange = Date.now();
  log.info('Level ' + next.toFixed(1) + '% → stop ' + running[running.length - 1]);
}
