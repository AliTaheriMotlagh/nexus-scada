import {
  alarmsAndTrend, B, calc, COLORS, desktopFrame, folder, hi, lo, mem, on, Page, PAGE_SIZES, sim, simDevice,
  type PageTemplate,
} from './builder.ts';

// ═══════════════════════════════ WATER: wastewater pump station ═══════════════════════════════
const pumpStation: PageTemplate = {
  id: 'pump-station',
  name: 'Wastewater pump station',
  category: 'Water',
  description: 'Wet well with three duty/assist pumps, lead/lag control on start/stop levels, fault fail-over, discharge pressure and flow.',
  defaultName: 'PumpStation',
  size: 'desktop',
  features: ['Lead/lag control script', 'Pump fault fail-over', 'Wet-well model', 'Overflow alarms'],
  nodes: (name) => simDevice(name, [
    mem('WetWellLevel', 50, { unit: '%', min: 0, max: 100, decimals: 1, writeRole: 'engineer', history: { deadband: 0.2 },
      alarms: [hi(85, 'Wet well level high ({value}%)'), { kind: 'hihi', limit: 95, severity: 'critical', message: 'Wet well overflow risk ({value}%)' }, lo(10, 'Wet well level low ({value}%)', 'medium')] }),
    sim('Inflow', 'sine', 60, 200, { unit: 'm³/h', period: 600, noise: 4, decimals: 0 }),
    calc('Outflow', "(tag('./Pump1/Running') ? tag('./Pump1/Speed') * 0.9 : 0) + (tag('./Pump2/Running') ? tag('./Pump2/Speed') * 0.9 : 0) + (tag('./Pump3/Running') ? tag('./Pump3/Speed') * 0.9 : 0)", { unit: 'm³/h', decimals: 0 }),
    sim('DischargePressure', 'randomWalk', 3, 6, { unit: 'bar', step: 0.05, decimals: 2, alarms: [hi(5.8, 'Discharge pressure high ({value} bar)', 'high', { delay: 5 })] }),
    mem('Mode', 'Auto', { states: { Auto: 'Automatic', Manual: 'Manual' } }),
    mem('StartLevel', 70, { unit: '%', min: 20, max: 95 }),
    mem('StopLevel', 35, { unit: '%', min: 5, max: 80 }),
    ...[1, 2, 3].map((i) => folder(`Pump${i}`, [
      mem('Running', false, { history: true, states: { false: 'Stopped', true: 'Running' } }),
      mem('Speed', 75, { unit: '%', min: 0, max: 100 }),
      calc('Current', "tag('./Running') ? 8 + tag('./Speed') * 0.32 : 0", { unit: 'A', decimals: 1, alarms: [hi(40, `Pump ${i} motor overload ({value} A)`)] }),
      mem('Fault', false, { alarms: [on(`Pump ${i} tripped`)] }),
    ])),
  ]),
  scripts: (base, name) => [{
    name: `${name}Control`,
    description: 'Wet-well model + lead/lag pump control with fail-over',
    triggers: [{ type: 'interval', ms: 1000 }],
    code: `// Wet-well mass balance + lead/lag pump control (runs every second)
const B = '${base}';
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
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Wet well & pumps' });
    p.text(40, 110, 200, 'Inflow ▸', 13);
    p.pipe(30, 150, 200, 'Inflow', { flowColor: '#a8a29e' });
    p.value(36, 176, 180, 'Inflow', 'In', { decimals: 0 });
    p.add('tank', 230, 110, 190, 300, { label: 'WET WELL', fillColor: '#a16207', unit: '%' }, {
      bindings: { level: B(p.t('WetWellLevel')), fillColor: B(p.t('WetWellLevel'), { map: [{ when: '>=85', value: '#ef4444' }, { when: 'default', value: '#a16207' }] }) },
      faceplate: { path: base },
    });
    p.add('numeric', 236, 420, 180, 32, { tag: p.t('StartLevel'), label: 'Start', unit: '%' });
    p.add('numeric', 236, 458, 180, 32, { tag: p.t('StopLevel'), label: 'Stop', unit: '%' });
    p.pipe(420, 380, 560, 'Outflow');
    p.pipe(480, 120, 500, 'Outflow');
    p.text(860, 92, 200, 'To treatment ▸', 13);
    [1, 2, 3].forEach((i) => {
      const x = 500 + (i - 1) * 170;
      const pump = `Pump${i}`;
      p.vpipe(x + 45, 255, 150, `${pump}/Running`, {}, 'value === true');
      p.add('valve', x + 15, 160, 60, 60, {}, { bindings: { open: B(p.t(`${pump}/Running`)) }, tooltip: `Check valve ${i}` });
      p.add('pump', x, 330, 90, 90, {}, {
        bindings: { running: B(p.t(`${pump}/Running`)), fault: B(p.t(`${pump}/Fault`)), speed: B(p.t(`${pump}/Speed`)) },
        faceplate: { path: p.t(pump) }, tooltip: `Pump ${i} — click for faceplate`,
      });
      p.text(x, 424, 90, `P-${i}`, 12, { align: 'center' });
      p.add('value', x - 10, 448, 110, 28, { tag: p.t(`${pump}/Current`), fontSize: 13 });
      p.add('multistate', x - 10, 482, 110, 26, { states: 'true:RUN:#16a34a,false:STOP:#475569,FAULT:TRIP:#dc2626' },
        { bindings: { value: B(p.t(`${pump}/Fault`), { expr: `value ? 'FAULT' : tag('${p.t(`${pump}/Running`)}')` }) } });
    });
    p.add('instrument', 930, 150, 56, 56, { function: 'PT', loop: '101', unit: 'bar', decimals: 2 }, { bindings: { value: B(p.t('DischargePressure')) } });
    p.add('instrument', 930, 222, 56, 56, { function: 'FT', loop: '102', unit: 'm³/h', decimals: 0 }, { bindings: { value: B(p.t('Outflow')) } });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('WetWellLevel'), min: 0, max: 100, label: 'Wet well', unit: '%', zones: '0:#f59e0b,15:#22c55e,85:#ef4444' });
    p.add('gauge', 1262, 90, 150, 136, { tag: p.t('Outflow'), min: 0, max: 250, label: 'Outflow', decimals: 0, zones: '0:#64748b,40:#22c55e' });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('DischargePressure'), min: 0, max: 8, label: 'Pressure', zones: '0:#22c55e,5.5:#f59e0b,5.8:#ef4444' });
    p.add('barChart', 1104, 232, 468, 76, { tags: ['Pump1/Current', 'Pump2/Current', 'Pump3/Current'].map((t) => p.t(t)).join(','), labels: 'P-1 A,P-2 A,P-3 A', max: 45, decimals: 1 });
    alarmsAndTrend(p, ['WetWellLevel', 'Inflow', 'Outflow']);
    p.add('dropdown', 1106, 670, 150, 32, { tag: p.t('Mode'), options: 'Auto:Auto (lead/lag),Manual:Manual' });
    [1, 2, 3].forEach((i) => {
      const y = 712 + (i - 1) * 42;
      p.add('switch', 1106, y, 120, 32, { tag: p.t(`Pump${i}/Running`), label: `P-${i}` });
      p.add('slider', 1230, y, 200, 32, { tag: p.t(`Pump${i}/Speed`), showValue: true });
      p.add('button', 1440, y, 130, 32, { text: 'Trip / reset', action: 'toggle', tag: p.t(`Pump${i}/Fault`), color: '#334155', activeColor: '#b91c1c', fontSize: 12 });
    });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ BUILDING: HVAC air-handling unit ═══════════════════════════════
const ahu: PageTemplate = {
  id: 'hvac-ahu',
  name: 'HVAC air-handling unit',
  category: 'Building',
  description: 'AHU with outside-air damper, filter, heating & cooling coils, supply/return fans, supply-air temperature control and CO₂ demand ventilation.',
  defaultName: 'AHU1',
  size: 'desktop',
  features: ['Supply-air temperature control', 'CO₂ demand-controlled ventilation', 'Filter dirty alarm', 'Frost protection'],
  nodes: (name) => simDevice(name, [
    sim('OutsideTemp', 'sine', 2, 32, { unit: '°C', period: 1800, decimals: 1 }),
    sim('ReturnTemp', 'sine', 21, 25, { unit: '°C', period: 900, decimals: 1 }),
    mem('OADamper', 30, { unit: '%', min: 0, max: 100, history: true }),
    calc('MixedTemp', "tag('./OutsideTemp') * tag('./OADamper') / 100 + tag('./ReturnTemp') * (1 - tag('./OADamper') / 100)", { unit: '°C', decimals: 1 }),
    mem('HeatingValve', 0, { unit: '%', min: 0, max: 100, history: true }),
    mem('CoolingValve', 0, { unit: '%', min: 0, max: 100, history: true }),
    calc('SupplyTemp', "tag('./SupplyFan') ? tag('./MixedTemp') + tag('./HeatingValve') * 0.18 - tag('./CoolingValve') * 0.16 : tag('./MixedTemp')",
      { unit: '°C', decimals: 1, alarms: [hi(30, 'Supply air too warm ({value} °C)', 'medium', { delay: 30 }), lo(10, 'Supply air too cold ({value} °C)', 'high', { delay: 30 })] }),
    mem('SupplySetpoint', 18, { unit: '°C', min: 12, max: 26, decimals: 1, history: true }),
    mem('SupplyFan', true, { history: true }),
    mem('FanSpeed', 70, { unit: '%', min: 20, max: 100 }),
    mem('ReturnFan', true),
    sim('FilterDP', 'randomWalk', 80, 280, { unit: 'Pa', step: 3, decimals: 0, alarms: [hi(250, 'Filter dirty — replace ({value} Pa)', 'low')] }),
    sim('CO2', 'randomWalk', 420, 1300, { unit: 'ppm', step: 15, decimals: 0, alarms: [hi(1100, 'CO₂ high in zone ({value} ppm)', 'medium', { delay: 20 })] }),
    calc('FrostAlarm', "tag('./MixedTemp') < 4", { dataType: 'boolean', history: false, alarms: [on('Frost protection — coil at risk', 'critical')] }),
  ]),
  scripts: (base, name) => [{
    name: `${name}Control`,
    description: 'Sequenced heating/cooling valves + CO₂ demand ventilation',
    triggers: [{ type: 'interval', ms: 2000 }],
    code: `// Supply-air temperature control (sequenced heat/cool) + demand-controlled ventilation
const B = '${base}';
const running: boolean = tags.get(B + '/SupplyFan');
const error = tags.get(B + '/SupplySetpoint') - tags.get(B + '/SupplyTemp');
let heat: number = tags.get(B + '/HeatingValve');
let cool: number = tags.get(B + '/CoolingValve');
if (!running) { heat = 0; cool = 0; }
else if (error > 0.3) { if (cool > 0) cool = Math.max(0, cool - 5); else heat = Math.min(100, heat + Math.min(8, error * 3)); }
else if (error < -0.3) { if (heat > 0) heat = Math.max(0, heat - 5); else cool = Math.min(100, cool - Math.max(-8, error * 3)); }
const damper = Math.min(100, Math.max(15, (tags.get(B + '/CO2') - 450) / 7));
await tags.writeMany({ [B + '/HeatingValve']: Math.round(heat), [B + '/CoolingValve']: Math.round(cool), [B + '/OADamper']: Math.round(damper) });
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Air-handling unit' });
    // supply duct
    p.add('rect', 60, 200, 980, 120, { fill: '#1e293b', stroke: '#334155', radius: 4, gradient: true }, { locked: true });
    p.text(64, 330, 200, '◂ Outside air', 12);
    p.text(930, 330, 120, 'Supply air ▸', 12);
    p.add('valve', 80, 225, 70, 70, {}, { bindings: { open: B(p.t('OADamper'), { expr: 'value > 20' }) }, tooltip: 'Outside-air damper' });
    p.add('progress', 76, 300, 80, 14, { tag: p.t('OADamper'), color: COLORS.water });
    p.add('rect', 190, 210, 50, 100, { fill: '#475569', stroke: '#94a3b8', radius: 2 }, { tooltip: 'Bag filter', bindings: { fill: B(p.t('FilterDP'), { map: [{ when: '>=250', value: '#b45309' }, { when: 'default', value: '#475569' }] }) } });
    p.text(180, 176, 80, 'Filter', 12, { align: 'center' });
    p.add('heatExchanger', 280, 225, 150, 70, { hotColor: '#ef4444', coldColor: '#f97316' }, { bindings: { active: B(p.t('HeatingValve'), { expr: 'value > 0' }) }, tooltip: 'Heating coil' });
    p.add('heatExchanger', 460, 225, 150, 70, { hotColor: '#3b82f6', coldColor: '#22d3ee' }, { bindings: { active: B(p.t('CoolingValve'), { expr: 'value > 0' }) }, tooltip: 'Cooling coil' });
    p.add('bar', 290, 330, 130, 22, { tag: p.t('HeatingValve'), orientation: 'horizontal', color: '#ef4444', min: 0, max: 100 });
    p.add('bar', 470, 330, 130, 22, { tag: p.t('CoolingValve'), orientation: 'horizontal', color: '#3b82f6', min: 0, max: 100 });
    p.add('fan', 690, 215, 90, 90, {}, { bindings: { running: B(p.t('SupplyFan')) }, faceplate: { path: p.t('SupplyFan') }, tooltip: 'Supply fan' });
    p.add('instrument', 100, 120, 56, 56, { function: 'TT', loop: 'OA', unit: '°C' }, { bindings: { value: B(p.t('OutsideTemp')) } });
    p.add('instrument', 250, 120, 56, 56, { function: 'TT', loop: 'MA', unit: '°C' }, { bindings: { value: B(p.t('MixedTemp')) } });
    p.add('instrument', 830, 120, 56, 56, { function: 'TIC', loop: 'SA', unit: '°C', mounting: 'panel' }, { bindings: { value: B(p.t('SupplyTemp')) } });
    p.add('instrument', 205, 380, 56, 56, { function: 'PDT', loop: 'F1', unit: 'Pa', decimals: 0 }, { bindings: { value: B(p.t('FilterDP')) } });
    // return duct
    p.add('rect', 60, 470, 980, 80, { fill: '#1e293b', stroke: '#334155', radius: 4 }, { locked: true });
    p.text(930, 556, 140, '◂ Return air', 12);
    p.add('fan', 690, 470, 80, 80, {}, { bindings: { running: B(p.t('ReturnFan')) }, tooltip: 'Return fan' });
    p.add('instrument', 830, 482, 56, 56, { function: 'TT', loop: 'RA', unit: '°C' }, { bindings: { value: B(p.t('ReturnTemp')) } });
    p.add('instrument', 940, 482, 56, 56, { function: 'AT', loop: 'CO2', unit: 'ppm', decimals: 0 }, { bindings: { value: B(p.t('CO2')) } });
    p.add('beacon', 340, 470, 60, 60, { color: '#38bdf8' }, { bindings: { active: B(p.t('FrostAlarm')) }, tooltip: 'Frost protection' });
    // KPI
    p.add('thermostat', 1110, 90, 150, 150, { min: 10, max: 32 }, { bindings: { value: B(p.t('SupplyTemp')), setpoint: B(p.t('SupplySetpoint')), heating: B(p.t('HeatingValve'), { expr: 'value > 0' }) } });
    p.add('gauge', 1270, 90, 150, 136, { tag: p.t('CO2'), min: 400, max: 1500, label: 'CO₂', decimals: 0, zones: '400:#22c55e,900:#f59e0b,1100:#ef4444' });
    p.add('gauge', 1424, 90, 150, 136, { tag: p.t('FilterDP'), min: 0, max: 300, label: 'Filter ΔP', decimals: 0, zones: '0:#22c55e,200:#f59e0b,250:#ef4444' });
    p.value(1110, 250, 220, 'OutsideTemp', 'Outside');
    p.value(1342, 250, 230, 'ReturnTemp', 'Return');
    alarmsAndTrend(p, ['SupplyTemp', 'SupplySetpoint', 'OutsideTemp', 'CO2']);
    p.add('switch', 1106, 674, 160, 32, { tag: p.t('SupplyFan'), label: 'Supply fan' });
    p.add('switch', 1276, 674, 160, 32, { tag: p.t('ReturnFan'), label: 'Return fan' });
    p.add('numeric', 1106, 718, 200, 34, { tag: p.t('SupplySetpoint'), label: 'SA setpoint', unit: '°C', step: 0.5 });
    p.add('slider', 1316, 718, 256, 34, { tag: p.t('FanSpeed') });
    p.value(1106, 764, 220, 'HeatingValve', 'Heating');
    p.value(1342, 764, 230, 'CoolingValve', 'Cooling');
    p.value(1106, 806, 220, 'OADamper', 'OA damper');
    p.value(1342, 806, 230, 'MixedTemp', 'Mixed air');
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ ENERGY: solar PV + battery ═══════════════════════════════
const solar: PageTemplate = {
  id: 'solar-battery',
  name: 'Solar PV + battery storage',
  category: 'Energy',
  description: 'PV array, hybrid inverter, home battery and grid connection with live power-flow animation, self-consumption logic and energy totals.',
  defaultName: 'SolarPlant',
  size: 'desktop',
  features: ['Power-flow animation', 'Battery charge/discharge strategy', 'Grid import/export', 'Inverter temperature alarm'],
  nodes: (name) => simDevice(name, [
    sim('Irradiance', 'sine', 0, 1000, { unit: 'W/m²', period: 1800, noise: 15, decimals: 0 }),
    calc('PVPower', "Math.max(0, tag('./Irradiance') * 8.2)", { unit: 'W', decimals: 0 }),
    sim('LoadPower', 'randomWalk', 400, 6500, { unit: 'W', step: 150, decimals: 0 }),
    mem('BatterySOC', 55, { unit: '%', min: 0, max: 100, decimals: 0, writeRole: 'engineer', history: true, alarms: [lo(15, 'Battery state of charge low ({value}%)', 'medium')] }),
    mem('BatteryPower', 0, { unit: 'W', decimals: 0, writeRole: 'engineer', history: true, description: '+ charging / − discharging' }),
    calc('GridPower', "tag('./LoadPower') - tag('./PVPower') + tag('./BatteryPower')", { unit: 'W', decimals: 0, description: '+ import / − export' }),
    calc('InverterTemp', "28 + tag('./PVPower') / 380", { unit: '°C', decimals: 1, alarms: [hi(48, 'Inverter temperature high ({value} °C)')] }),
    mem('EnergyToday', 0, { unit: 'kWh', decimals: 1, writeRole: 'engineer', history: true }),
    mem('Reserve', 20, { unit: '%', min: 0, max: 80 }),
    mem('ChargeLimit', 5000, { unit: 'W', min: 0, max: 10000 }),
  ]),
  scripts: (base, name) => [{
    name: `${name}Strategy`,
    description: 'Battery self-consumption strategy (time accelerated ×60 for the demo)',
    triggers: [{ type: 'interval', ms: 2000 }],
    code: `// Self-consumption: charge from PV surplus, discharge to cover the load above the reserve.
const B = '${base}';
const pv: number = tags.get(B + '/PVPower');
const load: number = tags.get(B + '/LoadPower');
const limit: number = tags.get(B + '/ChargeLimit');
let soc: number = tags.get(B + '/BatterySOC');
const surplus = pv - load;
let batt = 0;
if (surplus > 0 && soc < 100) batt = Math.min(surplus, limit);
else if (surplus < 0 && soc > tags.get(B + '/Reserve')) batt = Math.max(surplus, -limit);
const hours = (2 / 3600) * 60; // demo runs 60× faster than real time
soc = Math.min(100, Math.max(0, soc + ((batt / 1000) * hours / 13.5) * 100));
await tags.writeMany({
  [B + '/BatteryPower']: Math.round(batt),
  [B + '/BatterySOC']: Math.round(soc * 10) / 10,
  [B + '/EnergyToday']: Math.round((tags.get(B + '/EnergyToday') + (pv / 1000) * hours) * 10) / 10,
});
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Power flow' });
    p.add('solar', 60, 250, 210, 170, { unit: 'W' }, { bindings: { power: B(p.t('PVPower')) }, faceplate: { path: base } });
    p.pipe(268, 352, 252, 'PVPower', { color: '#475569', flowColor: COLORS.solar, speed: 0.8 }, 'value > 50');
    p.add('rect', 520, 300, 160, 110, { fill: '#1e293b', stroke: '#6366f1', strokeWidth: 2, radius: 10, gradient: true });
    p.text(530, 312, 140, 'HYBRID INVERTER', 11, { align: 'center', fontWeight: '700', color: '#a5b4fc' });
    p.add('value', 535, 350, 130, 30, { tag: p.t('InverterTemp'), fontSize: 13 });
    p.pipe(680, 352, 160, 'LoadPower', { color: '#475569', flowColor: '#fb923c' }, 'value > 50');
    p.add('house', 840, 240, 200, 190, { color: '#38bdf8' }, { bindings: { lit: B(p.t('LoadPower'), { expr: 'value > 3000' }) } });
    p.value(850, 440, 180, 'LoadPower', 'Load', { decimals: 0 });
    p.add('rect', 540, 90, 120, 110, { fill: '#1e293b', stroke: '#64748b', radius: 8 });
    p.text(550, 100, 100, '⚡ GRID', 16, { align: 'center', fontWeight: '700', color: COLORS.text });
    p.add('value', 548, 150, 104, 30, { tag: p.t('GridPower'), fontSize: 13 });
    p.add('pipe', 540, 241, 120, 18, { color: '#475569', flowColor: '#a78bfa' }, {
      rotation: 90,
      bindings: { flowing: B(p.t('GridPower'), { expr: 'Math.abs(value) > 50' }), direction: B(p.t('GridPower'), { map: [{ when: '>0', value: 'right' }, { when: 'default', value: 'left' }] }) },
    });
    p.add('pipe', 570, 446, 60, 18, { color: '#475569', flowColor: COLORS.ok }, {
      rotation: 90,
      bindings: { flowing: B(p.t('BatteryPower'), { expr: 'Math.abs(value) > 50' }), direction: B(p.t('BatteryPower'), { map: [{ when: '>0', value: 'right' }, { when: 'default', value: 'left' }] }) },
    });
    p.add('battery', 555, 478, 90, 130, {}, { bindings: { level: B(p.t('BatterySOC')) }, faceplate: { path: p.t('BatterySOC') } });
    p.value(660, 520, 200, 'BatteryPower', 'Battery', { decimals: 0 });
    p.add('multistate', 860, 120, 170, 32, { states: 'true:EXPORTING:#16a34a,false:IMPORTING:#9333ea' }, { bindings: { value: B(p.t('GridPower'), { expr: 'value < 0' }) } });
    p.value(60, 440, 210, 'PVPower', 'PV', { decimals: 0 });
    p.value(60, 480, 210, 'Irradiance', 'Sun', { decimals: 0 });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('PVPower'), min: 0, max: 9000, label: 'PV', decimals: 0, color: COLORS.solar, zones: '0:#64748b,500:#22c55e' });
    p.add('gauge', 1262, 90, 150, 136, { tag: p.t('LoadPower'), min: 0, max: 8000, label: 'Load', decimals: 0, zones: '0:#22c55e,5000:#f59e0b,7000:#ef4444' });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('BatterySOC'), min: 0, max: 100, label: 'Battery', decimals: 0, zones: '0:#ef4444,20:#f59e0b,40:#22c55e' });
    p.value(1104, 250, 228, 'EnergyToday', 'Yield today', { decimals: 1 });
    p.value(1342, 250, 230, 'GridPower', 'Grid', { decimals: 0 });
    alarmsAndTrend(p, ['PVPower', 'LoadPower', 'GridPower', 'BatterySOC']);
    p.add('numeric', 1106, 674, 220, 34, { tag: p.t('Reserve'), label: 'Reserve', unit: '%', step: 5 });
    p.add('numeric', 1340, 674, 232, 34, { tag: p.t('ChargeLimit'), label: 'Max', unit: 'W', step: 500 });
    p.add('barChart', 1106, 716, 466, 160, { tags: ['PVPower', 'LoadPower', 'GridPower', 'BatteryPower'].map((t) => p.t(t)).join(','), labels: 'PV,Load,Grid,Battery', max: 9000, decimals: 0, color: '#eab308' });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ INDUSTRY: boiler room ═══════════════════════════════
const boilerRoom: PageTemplate = {
  id: 'boiler-room',
  name: 'Steam boiler house',
  category: 'Industry',
  description: 'Two fire-tube boilers with burner modulation, drum level, steam header pressure control, feed-water pump and flue-gas monitoring.',
  defaultName: 'BoilerHouse',
  size: 'desktop',
  features: ['Pressure-controlled lead/lag firing', 'Low-water & high-pressure trips', 'Flue gas temperature'],
  nodes: (name) => simDevice(name, [
    mem('HeaderPressure', 9, { unit: 'bar', decimals: 2, writeRole: 'engineer', history: true, alarms: [hi(10.5, 'Steam header pressure high ({value} bar)', 'high'), lo(7, 'Steam header pressure low ({value} bar)', 'medium')] }),
    mem('PressureSetpoint', 9, { unit: 'bar', min: 6, max: 10.5, decimals: 1 }),
    sim('SteamDemand', 'randomWalk', 2, 9, { unit: 't/h', step: 0.2, decimals: 1 }),
    ...[1, 2].map((i) => folder(`Boiler${i}`, [
      mem('Enabled', true),
      mem('Firing', i === 1),
      mem('Modulation', i === 1 ? 50 : 0, { unit: '%', min: 0, max: 100, history: true }),
      sim('DrumLevel', 'sine', 42, 68, { unit: '%', period: 300 + i * 70, decimals: 0, alarms: [lo(35, `Boiler ${i} low water level`, 'critical')] }),
      calc('FlueTemp', "tag('./Firing') ? 140 + tag('./Modulation') * 0.9 : 60", { unit: '°C', decimals: 0, alarms: [hi(225, `Boiler ${i} flue gas temperature high`, 'medium')] }),
      calc('SteamOutput', "tag('./Firing') ? tag('./Modulation') * 0.06 : 0", { unit: 't/h', decimals: 2 }),
    ])),
    mem('FeedPump', true, { history: true }),
    calc('GasFlow', "(tag('./Boiler1/Firing') ? tag('./Boiler1/Modulation') * 4.2 : 0) + (tag('./Boiler2/Firing') ? tag('./Boiler2/Modulation') * 4.2 : 0)", { unit: 'm³/h', decimals: 0 }),
  ]),
  scripts: (base, name) => [{
    name: `${name}Control`,
    description: 'Header pressure model + burner modulation + lead/lag firing',
    triggers: [{ type: 'interval', ms: 1000 }],
    code: `// Steam header model with proportional burner modulation and lead/lag boiler firing
const B = '${base}';
const boilers = ['Boiler1', 'Boiler2'].map((b) => B + '/' + b);
const sp: number = tags.get(B + '/PressureSetpoint');
const supply = boilers.reduce((s, b) => s + (tags.get(b + '/SteamOutput') ?? 0), 0);
let pressure: number = tags.get(B + '/HeaderPressure');
pressure = Math.max(0, pressure + (supply - tags.get(B + '/SteamDemand')) * 0.02);
await tags.write(B + '/HeaderPressure', Math.round(pressure * 100) / 100);
const mod = Math.min(100, Math.max(20, 50 + (sp - pressure) * 60));
for (const b of boilers) {
  const ok = tags.get(b + '/Enabled') && tags.get(b + '/DrumLevel') > 35 && pressure < 10.8;
  if (!ok && tags.get(b + '/Firing')) { await tags.write(b + '/Firing', false); log.warn(b + ' tripped'); }
  if (tags.get(b + '/Firing')) await tags.write(b + '/Modulation', Math.round(mod));
}
const lag = boilers[1];
if (pressure < sp - 0.6 && !tags.get(lag + '/Firing') && tags.get(lag + '/Enabled')) { await tags.write(lag + '/Firing', true); log.info('Lag boiler started'); }
if (pressure > sp + 0.4 && tags.get(lag + '/Firing')) { await tags.writeMany({ [lag + '/Firing']: false, [lag + '/Modulation']: 0 }); log.info('Lag boiler stopped'); }
if (!tags.get(boilers[0] + '/Firing') && tags.get(boilers[0] + '/Enabled') && tags.get(boilers[0] + '/DrumLevel') > 40) await tags.write(boilers[0] + '/Firing', true);
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Boilers & steam header' });
    p.pipe(60, 120, 900, 'HeaderPressure', { color: '#78716c', flowColor: '#f1f5f9' }, 'value > 1');
    p.text(840, 92, 200, 'Steam to plant ▸', 13);
    p.add('instrument', 960, 96, 56, 56, { function: 'PIC', loop: '100', unit: 'bar', decimals: 2, mounting: 'panel' }, { bindings: { value: B(p.t('HeaderPressure')) } });
    [1, 2].forEach((i) => {
      const x = 120 + (i - 1) * 380;
      const b = `Boiler${i}`;
      p.vpipe(x + 60, 175, 100, `${b}/Firing`, { color: '#78716c', flowColor: '#f1f5f9' }, 'value === true');
      p.add('boiler', x, 220, 120, 200, {}, { bindings: { firing: B(p.t(`${b}/Firing`)) }, faceplate: { path: p.t(b) } });
      p.text(x, 424, 120, `BOILER ${i}`, 12, { align: 'center', fontWeight: '700' });
      p.add('bar', x + 140, 230, 36, 180, { tag: p.t(`${b}/DrumLevel`), min: 0, max: 100, color: COLORS.water });
      p.text(x + 128, 412, 60, 'Level', 11, { align: 'center' });
      p.add('progress', x, 456, 200, 20, { tag: p.t(`${b}/Modulation`), color: '#f97316' });
      p.value(x, 484, 200, `${b}/FlueTemp`, 'Flue');
      p.add('multistate', x, 526, 200, 28, { states: 'true:FIRING:#ea580c,false:STANDBY:#475569' }, { bindings: { value: B(p.t(`${b}/Firing`)) } });
    });
    p.add('pump', 860, 400, 90, 90, {}, { bindings: { running: B(p.t('FeedPump')) }, tooltip: 'Feed-water pump' });
    p.text(840, 494, 130, 'Feed water', 12, { align: 'center' });
    p.pipe(170, 560, 690, 'FeedPump', { flowColor: COLORS.water, direction: 'left' }, 'value === true');
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('HeaderPressure'), min: 0, max: 12, label: 'Header', zones: '0:#f59e0b,7:#22c55e,10.5:#ef4444' });
    p.add('gauge', 1262, 90, 150, 136, { tag: p.t('GasFlow'), min: 0, max: 900, label: 'Gas', decimals: 0 });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('SteamDemand'), min: 0, max: 12, label: 'Demand t/h', decimals: 1, color: '#e2e8f0', zones: '0:#22c55e' });
    p.value(1104, 250, 228, 'Boiler1/SteamOutput', 'B1 steam');
    p.value(1342, 250, 230, 'Boiler2/SteamOutput', 'B2 steam');
    alarmsAndTrend(p, ['HeaderPressure', 'PressureSetpoint', 'SteamDemand', 'GasFlow']);
    p.add('numeric', 1106, 674, 220, 34, { tag: p.t('PressureSetpoint'), label: 'Setpoint', unit: 'bar', step: 0.1 });
    p.add('switch', 1340, 674, 230, 32, { tag: p.t('FeedPump'), label: 'Feed pump' });
    p.add('switch', 1106, 720, 220, 32, { tag: p.t('Boiler1/Enabled'), label: 'Boiler 1 enabled' });
    p.add('switch', 1340, 720, 230, 32, { tag: p.t('Boiler2/Enabled'), label: 'Boiler 2 enabled' });
    p.add('sparkline', 1106, 766, 466, 110, { tag: p.t('HeaderPressure'), color: '#f97316', decimals: 2 });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ INDUSTRY: tank farm ═══════════════════════════════
const PRODUCTS = [['Diesel', '#facc15', 500], ['Gasoline', '#fb923c', 500], ['Jet A-1', '#a3e635', 800], ['Water', '#38bdf8', 300]] as const;
const tankFarm: PageTemplate = {
  id: 'tank-farm',
  name: 'Tank farm inventory',
  category: 'Industry',
  description: 'Four storage tanks with product, level, temperature, volume, total inventory and high/low level alarms — terminal or depot overview.',
  defaultName: 'TankFarm',
  size: 'desktop',
  features: ['Inventory totals', 'Level alarms per tank', 'Volume from strapping'],
  nodes: (name) => simDevice(name, [
    ...PRODUCTS.map(([product, , capacity], i) => folder(`T${i + 1}`, [
      mem('Product', product),
      mem('Capacity', capacity, { unit: 'm³', writeRole: 'engineer' }),
      sim('Level', 'sine', 8 + i * 4, 92 - i * 3, { unit: '%', period: 600 + i * 170, phase: i, decimals: 1,
        alarms: [hi(90, `Tank T${i + 1} high level ({value}%)`), lo(10, `Tank T${i + 1} low level ({value}%)`, 'medium')] }),
      sim('Temperature', 'sine', 12 + i, 24 + i, { unit: '°C', period: 1200, decimals: 1 }),
      calc('Volume', "tag('./Level') / 100 * tag('./Capacity')", { unit: 'm³', decimals: 0 }),
    ])),
    calc('TotalVolume', PRODUCTS.map((_, i) => `tag('./T${i + 1}/Volume')`).join(' + '), { unit: 'm³', decimals: 0 }),
  ]),
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Storage tanks', trend: 'Levels — 30 min' });
    PRODUCTS.forEach(([product, color], i) => {
      const x = 50 + i * 255;
      const t = `T${i + 1}`;
      p.add('tank', x, 110, 170, 300, { label: t, fillColor: color, unit: '%' }, { bindings: { level: B(p.t(`${t}/Level`)) }, faceplate: { path: p.t(t) } });
      p.add('value', x - 10, 420, 190, 30, { tag: p.t(`${t}/Product`), fontSize: 14, color, label: 'Product' });
      p.value(x - 10, 456, 190, `${t}/Volume`, 'Vol', { decimals: 0 });
      p.value(x - 10, 496, 190, `${t}/Temperature`, 'Temp');
      p.add('led', x - 10, 540, 190, 28, { label: 'Level alarm', onColor: '#ef4444', blinkWhenOn: true }, { bindings: { value: B(p.t(`${t}/Level`), { expr: 'value >= 90 || value <= 10' }) } });
      p.text(x - 10, 80, 190, product.toUpperCase(), 12, { align: 'center', fontWeight: '700', color });
    });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('TotalVolume'), min: 0, max: 2100, label: 'Inventory m³', decimals: 0, zones: '0:#f59e0b,300:#22c55e,1900:#ef4444' });
    p.add('barChart', 1262, 88, 310, 214, { tags: PRODUCTS.map((_, i) => p.t(`T${i + 1}/Volume`)).join(','), labels: PRODUCTS.map(([n]) => n).join(','), max: 800, decimals: 0, color: '#0ea5e9' });
    p.value(1104, 250, 150, 'TotalVolume', 'Total', { decimals: 0 });
    p.add('trend', 1104, 356, 468, 258, { tags: PRODUCTS.map((_, i) => p.t(`T${i + 1}/Level`)).join(','), minutes: 30 });
    p.add('alarmTable', 16, 638, 1064, 248, { area: base, maxRows: 8 });
    PRODUCTS.forEach((_, i) => {
      p.add('button', 1106 + (i % 2) * 236, 676 + Math.floor(i / 2) * 50, 226, 40, { text: `T${i + 1} faceplate`, action: 'faceplate', target: p.t(`T${i + 1}`), color: '#334155' });
    });
    p.add('clock', 1106, 790, 466, 40, { format: 'datetime', fontSize: 16 });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ FOOD: cold storage ═══════════════════════════════
const ROOMS = [['Freezer1', -24, -18], ['Freezer2', -22, -17], ['Chiller', 1, 5], ['Dock', 8, 14]] as const;
const coldStore: PageTemplate = {
  id: 'cold-storage',
  name: 'Cold storage warehouse',
  category: 'Food & Agri',
  description: 'Freezer, chiller and loading-dock rooms with temperatures, setpoints, door-open alarms with delay, compressors and suction pressure — food-safety (HACCP) monitoring.',
  defaultName: 'ColdStore',
  size: 'desktop',
  features: ['HACCP temperature alarms with delay', 'Door-open alarms', 'Compressor status'],
  nodes: (name) => simDevice(name, [
    ...ROOMS.map(([room, min, max], i) => folder(room, [
      sim('Temperature', 'sine', min, max, { unit: '°C', period: 700 + i * 130, noise: 0.15, decimals: 1,
        alarms: [hi(max - 0.6, `${room} temperature high ({value} °C)`, 'high', { delay: 30, deadband: 0.3 })] }),
      mem('Setpoint', Math.round((min + max) / 2), { unit: '°C', min: -30, max: 15, decimals: 1 }),
      sim('DoorOpen', 'toggle', 0, 1, { period: 200 + i * 77, history: false, alarms: [on(`${room} door open too long`, 'low', { delay: 45 })] }),
    ])),
    sim('Compressor1', 'toggle', 0, 1, { period: 420 }),
    sim('Compressor2', 'toggle', 0, 1, { period: 610 }),
    sim('SuctionPressure', 'randomWalk', 0.8, 2.6, { unit: 'bar', step: 0.04, decimals: 2 }),
  ]),
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Rooms', trend: 'Temperatures — 30 min' });
    ROOMS.forEach(([room], i) => {
      const x = 32 + (i % 2) * 520;
      const y = 96 + Math.floor(i / 2) * 260;
      p.add('rect', x, y, 500, 240, { fill: '#0b1220', stroke: '#1e3a8a', radius: 10, strokeWidth: 2 },
        { bindings: { stroke: B(p.t(`${room}/Temperature`), { expr: `value > ${ROOMS[i][2] - 0.6} ? '#ef4444' : '#1e3a8a'` }) }, faceplate: { path: p.t(room) } });
      p.text(x + 16, y + 10, 300, room.toUpperCase(), 14, { fontWeight: '700', color: COLORS.text });
      p.add('thermostat', x + 16, y + 44, 170, 170, { min: ROOMS[i][1] - 6, max: ROOMS[i][2] + 6 }, { bindings: { value: B(p.t(`${room}/Temperature`)), setpoint: B(p.t(`${room}/Setpoint`)) } });
      p.add('door', x + 210, y + 50, 70, 104, {}, { bindings: { open: B(p.t(`${room}/DoorOpen`)) } });
      p.add('led', x + 200, y + 164, 120, 28, { tag: p.t(`${room}/DoorOpen`), label: 'Door', onColor: '#f59e0b' });
      p.add('numeric', x + 300, y + 50, 180, 32, { tag: p.t(`${room}/Setpoint`), label: 'SP', unit: '°C', step: 0.5 });
      p.add('sparkline', x + 300, y + 96, 180, 96, { tag: p.t(`${room}/Temperature`), color: '#38bdf8' });
    });
    p.add('compressor', 1110, 96, 90, 90, {}, { bindings: { running: B(p.t('Compressor1')) } });
    p.add('compressor', 1220, 96, 90, 90, {}, { bindings: { running: B(p.t('Compressor2')) } });
    p.text(1110, 190, 90, 'C1', 12, { align: 'center' });
    p.text(1220, 190, 90, 'C2', 12, { align: 'center' });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('SuctionPressure'), min: 0, max: 4, label: 'Suction', zones: '0:#f59e0b,1:#22c55e,2.4:#ef4444' });
    p.value(1104, 250, 468, 'SuctionPressure', 'Suction pressure');
    p.add('trend', 1104, 356, 468, 258, { tags: ROOMS.map(([r]) => p.t(`${r}/Temperature`)).join(','), minutes: 30 });
    p.add('alarmTable', 16, 638, 1064, 248, { area: base, maxRows: 8 });
    p.add('barChart', 1106, 672, 466, 206, { tags: ROOMS.map(([r]) => p.t(`${r}/Temperature`)).join(','), labels: ROOMS.map(([r]) => r).join(','), max: 15, decimals: 1, color: '#38bdf8' });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ AGRI: greenhouse ═══════════════════════════════
const greenhouse: PageTemplate = {
  id: 'greenhouse',
  name: 'Smart greenhouse',
  category: 'Food & Agri',
  description: 'Climate and irrigation control: air temperature, humidity, soil moisture, light and CO₂ with automatic vents, heater, grow lights and drip irrigation.',
  defaultName: 'Greenhouse',
  size: 'desktop',
  features: ['Auto irrigation on soil moisture', 'Vent & heater climate control', 'Grow lights on low light'],
  nodes: (name) => simDevice(name, [
    sim('AirTemp', 'sine', 15, 34, { unit: '°C', period: 1200, noise: 0.2, decimals: 1, alarms: [hi(33, 'Greenhouse too hot ({value} °C)'), lo(12, 'Frost risk ({value} °C)', 'critical')] }),
    sim('Humidity', 'randomWalk', 45, 92, { unit: '%', step: 1, decimals: 0, alarms: [hi(90, 'Humidity high — fungal risk', 'low', { delay: 60 })] }),
    mem('SoilMoisture', 40, { unit: '%', decimals: 1, writeRole: 'engineer', history: true, alarms: [lo(22, 'Soil too dry ({value}%)', 'medium')] }),
    sim('Light', 'sine', 0, 60000, { unit: 'lx', period: 1800, decimals: 0 }),
    sim('CO2', 'randomWalk', 380, 1100, { unit: 'ppm', step: 12, decimals: 0 }),
    mem('WaterTank', 80, { unit: '%', decimals: 0, writeRole: 'engineer', history: true, alarms: [lo(15, 'Irrigation water tank low', 'medium')] }),
    mem('Auto', true),
    mem('Vents', 10, { unit: '%', min: 0, max: 100, history: true }),
    mem('Irrigation', false, { history: true }),
    mem('GrowLights', false, { history: true }),
    mem('Heater', false, { history: true }),
    mem('Fans', false),
  ]),
  scripts: (base, name) => [{
    name: `${name}Climate`,
    description: 'Soil-moisture model + automatic climate & irrigation control',
    triggers: [{ type: 'interval', ms: 2000 }],
    code: `// Greenhouse model and automatic control
const B = '${base}';
let soil: number = tags.get(B + '/SoilMoisture');
let tank: number = tags.get(B + '/WaterTank');
const irrigating: boolean = tags.get(B + '/Irrigation');
soil = Math.max(0, soil - 0.08 - (tags.get(B + '/AirTemp') > 28 ? 0.05 : 0));
if (irrigating && tank > 0) { soil = Math.min(100, soil + 0.9); tank = Math.max(0, tank - 0.3); }
if (tank < 20) tank += 0.5; // refill valve
await tags.writeMany({ [B + '/SoilMoisture']: Math.round(soil * 10) / 10, [B + '/WaterTank']: Math.round(tank * 10) / 10 });

if (!tags.get(B + '/Auto')) return;
const t: number = tags.get(B + '/AirTemp');
await tags.writeMany({
  [B + '/Irrigation']: soil < 30 ? true : soil > 45 ? false : irrigating,
  [B + '/Vents']: t > 28 ? 85 : t > 25 ? 40 : 10,
  [B + '/Fans']: t > 30,
  [B + '/Heater']: t < 17,
  [B + '/GrowLights']: tags.get(B + '/Light') < 12000,
});
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Greenhouse' });
    p.add('rect', 60, 170, 700, 380, { fill: '#0c2a1c', stroke: '#86efac', strokeWidth: 2, radius: 6 }, { locked: true });
    p.add('rect', 60, 110, 700, 64, { fill: '#123524', stroke: '#86efac', strokeWidth: 2, radius: 4 }, { locked: true });
    [0, 1, 2, 3, 4].forEach((i) => p.add('lamp', 110 + i * 130, 182, 60, 72, { onColor: '#e879f9' }, { bindings: { on: B(p.t('GrowLights')) }, tooltip: 'Grow light' }));
    [0, 1].forEach((i) => p.add('fan', 160 + i * 400, 106, 70, 70, {}, { bindings: { running: B(p.t('Fans')) } }));
    p.add('progress', 330, 132, 160, 20, { tag: p.t('Vents'), color: '#86efac' });
    p.text(330, 108, 160, 'Roof vents', 11, { align: 'center' });
    for (let r = 0; r < 4; r++) p.add('rect', 100 + r * 160, 380, 120, 120, { fill: '#365314', stroke: '#65a30d', radius: 8 }, { locked: true });
    p.pipe(90, 352, 640, 'Irrigation', { flowColor: COLORS.water }, 'value === true');
    p.add('valve', 780, 324, 70, 70, {}, { bindings: { open: B(p.t('Irrigation')) }, tooltip: 'Drip irrigation valve' });
    p.add('tank', 880, 260, 120, 220, { label: 'WATER', fillColor: COLORS.water }, { bindings: { level: B(p.t('WaterTank')) } });
    p.add('boiler', 880, 96, 90, 140, {}, { bindings: { firing: B(p.t('Heater')) }, tooltip: 'Heater' });
    p.value(80, 560, 220, 'SoilMoisture', 'Soil');
    p.value(320, 560, 220, 'Light', 'Light', { decimals: 0 });
    p.value(560, 560, 200, 'CO2', 'CO₂', { decimals: 0 });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('AirTemp'), min: 0, max: 40, label: 'Air', zones: '0:#3b82f6,15:#22c55e,30:#ef4444' });
    p.add('gauge', 1262, 90, 150, 136, { tag: p.t('Humidity'), min: 0, max: 100, label: 'Humidity', decimals: 0, zones: '0:#f59e0b,50:#22c55e,88:#ef4444' });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('SoilMoisture'), min: 0, max: 80, label: 'Soil', decimals: 0, zones: '0:#ef4444,25:#22c55e,55:#3b82f6' });
    p.add('sparkline', 1104, 240, 468, 66, { tag: p.t('Light'), color: COLORS.solar, decimals: 0 });
    alarmsAndTrend(p, ['AirTemp', 'Humidity', 'SoilMoisture']);
    p.add('switch', 1106, 674, 220, 32, { tag: p.t('Auto'), label: 'Automatic mode', onColor: COLORS.accent });
    p.add('switch', 1106, 716, 220, 32, { tag: p.t('Irrigation'), label: 'Irrigation' });
    p.add('switch', 1340, 716, 230, 32, { tag: p.t('GrowLights'), label: 'Grow lights' });
    p.add('switch', 1106, 758, 220, 32, { tag: p.t('Heater'), label: 'Heater' });
    p.add('switch', 1340, 758, 230, 32, { tag: p.t('Fans'), label: 'Fans' });
    p.add('slider', 1106, 800, 466, 34, { tag: p.t('Vents'), color: '#86efac' });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ INDUSTRY: packaging line OEE ═══════════════════════════════
const STATIONS = ['Infeed', 'Filler', 'Capper', 'Labeler', 'Packer'];
const packagingLine: PageTemplate = {
  id: 'packaging-line',
  name: 'Bottling / packaging line (OEE)',
  category: 'Industry',
  description: 'Five-station line with conveyors, machine state, good/reject counters, random stops and live OEE (availability × performance × quality).',
  defaultName: 'Line1',
  size: 'desktop',
  features: ['Live OEE', 'Machine states & downtime', 'Production counters'],
  nodes: (name) => simDevice(name, [
    mem('Running', true, { history: true }),
    mem('Speed', 120, { unit: 'bpm', min: 0, max: 150, history: true }),
    mem('State', 'Running', { states: { Running: 'Running', Stopped: 'Stopped', Fault: 'Fault', Starved: 'Starved' }, alarms: [{ kind: 'equals', limit: 'Fault', severity: 'high', message: 'Line stopped on fault' }] }),
    mem('FaultStation', ''),
    mem('Good', 0, { writeRole: 'operator', history: { interval: 60 } }),
    mem('Rejects', 0, { writeRole: 'operator', history: { interval: 60 } }),
    mem('RunSeconds', 1, { writeRole: 'operator' }),
    mem('TotalSeconds', 1, { writeRole: 'operator' }),
    calc('Availability', "tag('./RunSeconds') / Math.max(1, tag('./TotalSeconds')) * 100", { unit: '%', decimals: 1 }),
    calc('Performance', "tag('./Speed') / 150 * 100", { unit: '%', decimals: 1 }),
    calc('Quality', "tag('./Good') / Math.max(1, tag('./Good') + tag('./Rejects')) * 100", { unit: '%', decimals: 1 }),
    calc('OEE', "tag('./Availability') * tag('./Performance') * tag('./Quality') / 10000", { unit: '%', decimals: 1, alarms: [lo(60, 'OEE below target ({value}%)', 'low', { delay: 60 })] }),
    sim('FillerTemp', 'sine', 18, 26, { unit: '°C', period: 900, decimals: 1 }),
  ]),
  scripts: (base, name) => [{
    name: `${name}Model`,
    description: 'Production counters, random stops and OEE time base',
    triggers: [{ type: 'interval', ms: 1000 }],
    code: `// Packaging line model: counts, random faults (auto-cleared after 12 s) and OEE time base
const B = '${base}';
const stations = ['Infeed', 'Filler', 'Capper', 'Labeler', 'Packer'];
let st: string = tags.get(B + '/State');
const running: boolean = tags.get(B + '/Running');
if (st === 'Fault' && Date.now() - (state.faultAt ?? 0) > 12000) { st = 'Running'; await tags.write(B + '/FaultStation', ''); }
if (!running) st = 'Stopped';
else if (st === 'Stopped') st = 'Running';
if (st === 'Running' && Math.random() < 0.01) {
  st = 'Fault';
  state.faultAt = Date.now();
  const where = stations[Math.floor(Math.random() * stations.length)];
  await tags.write(B + '/FaultStation', where);
  log.warn('Fault at ' + where);
}
const updates: Record<string, unknown> = { [B + '/State']: st, [B + '/TotalSeconds']: tags.get(B + '/TotalSeconds') + 1 };
if (st === 'Running') {
  const made = tags.get(B + '/Speed') / 60;
  const rejects = Math.random() < 0.04 ? 1 : 0;
  updates[B + '/Good'] = Math.round((tags.get(B + '/Good') + made - rejects) * 10) / 10;
  updates[B + '/Rejects'] = tags.get(B + '/Rejects') + rejects;
  updates[B + '/RunSeconds'] = tags.get(B + '/RunSeconds') + 1;
}
await tags.writeMany(updates);
`,
  }],
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Line overview', kpi: 'OEE' });
    const running = B(p.t('State'), { expr: "value === 'Running'" });
    STATIONS.forEach((s, i) => {
      const x = 40 + i * 205;
      p.add('rect', x, 120, 170, 150, { fill: '#1e293b', stroke: '#334155', radius: 10, gradient: true },
        { bindings: { stroke: B(p.t('FaultStation'), { expr: `value === '${s}' ? '#ef4444' : '#334155'` }) } });
      p.text(x + 10, 128, 150, s.toUpperCase(), 13, { align: 'center', fontWeight: '700', color: COLORS.text });
      p.add('motor', x + 25, 170, 120, 80, {}, { bindings: { running, fault: B(p.t('FaultStation'), { expr: `value === '${s}'` }) } });
      if (i < STATIONS.length - 1) p.add('conveyor', x + 165, 300, 210, 40, {}, { bindings: { running } });
    });
    p.add('conveyor', 40, 300, 170, 40, {}, { bindings: { running } });
    p.add('multistate', 40, 380, 300, 50, { tag: p.t('State'), states: 'Running:RUNNING:#16a34a,Stopped:STOPPED:#475569,Fault:FAULT:#dc2626,Starved:STARVED:#ca8a04' });
    p.add('value', 360, 380, 330, 50, { tag: p.t('FaultStation'), label: 'Fault at', fontSize: 18, color: '#fca5a5' });
    p.value(40, 450, 300, 'Good', 'Good', { decimals: 0, fontSize: 22 });
    p.value(360, 450, 330, 'Rejects', 'Rejects', { decimals: 0, fontSize: 22, color: '#fca5a5' });
    p.value(710, 380, 340, 'Speed', 'Speed', { fontSize: 18, decimals: 0 });
    p.value(710, 450, 340, 'FillerTemp', 'Filler temp', { fontSize: 18 });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('OEE'), min: 0, max: 100, label: 'OEE', decimals: 0, zones: '0:#ef4444,60:#f59e0b,85:#22c55e' });
    p.add('barChart', 1262, 88, 310, 214, { tags: ['Availability', 'Performance', 'Quality', 'OEE'].map((t) => p.t(t)).join(','), labels: 'Avail.,Perf.,Quality,OEE', max: 100, decimals: 0, color: '#22c55e' });
    p.value(1104, 250, 150, 'Availability', 'A', { decimals: 0 });
    alarmsAndTrend(p, ['Speed', 'OEE']);
    p.add('button', 1106, 674, 220, 44, { text: '▶ Start line', action: 'write', tag: p.t('Running'), value: 'true', color: '#16a34a' });
    p.add('button', 1340, 674, 230, 44, { text: '■ Stop line', action: 'write', tag: p.t('Running'), value: 'false', color: '#b91c1c', confirm: true });
    p.add('slider', 1106, 730, 466, 34, { tag: p.t('Speed'), min: 0, max: 150, step: 5 });
    p.add('button', 1106, 778, 466, 40, { text: 'Reset shift counters', color: '#334155', confirm: true },
      { events: { click: `await tags.writeMany({ '${p.t('Good')}': 0, '${p.t('Rejects')}': 0, '${p.t('RunSeconds')}': 1, '${p.t('TotalSeconds')}': 1 });\nui.toast('Shift counters reset', 'success');` } });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ ENERGY: power monitoring ═══════════════════════════════
const LOADS = ['HVAC', 'Lighting', 'Production', 'Office', 'EVCharging'];
const energyMeter: PageTemplate = {
  id: 'energy-monitoring',
  name: 'Energy & power-quality monitoring',
  category: 'Energy',
  description: 'Three-phase main incomer (voltage, current, power factor, frequency) with sub-metering of building loads and demand / power-factor alarms.',
  defaultName: 'EnergyMeter',
  size: 'desktop',
  features: ['3-phase V/I', 'Power factor alarm', 'Sub-meter breakdown'],
  nodes: (name) => simDevice(name, [
    ...[1, 2, 3].map((l) => sim(`VoltageL${l}`, 'randomWalk', 224, 238, { unit: 'V', step: 0.6, decimals: 1, alarms: [hi(236, `Overvoltage L${l}`, 'low', { delay: 10 })] })),
    ...[1, 2, 3].map((l) => sim(`CurrentL${l}`, 'randomWalk', 60, 240, { unit: 'A', step: 6, decimals: 0 })),
    sim('PowerFactor', 'randomWalk', 0.84, 0.99, { unit: '', step: 0.006, decimals: 3, alarms: [lo(0.88, 'Poor power factor ({value})', 'medium', { delay: 20 })] }),
    sim('Frequency', 'randomWalk', 49.9, 50.1, { unit: 'Hz', step: 0.01, decimals: 2 }),
    calc('ActivePower', "(tag('./VoltageL1') * tag('./CurrentL1') + tag('./VoltageL2') * tag('./CurrentL2') + tag('./VoltageL3') * tag('./CurrentL3')) * tag('./PowerFactor') / 1000",
      { unit: 'kW', decimals: 1, alarms: [hi(140, 'Demand above contract ({value} kW)', 'high', { delay: 30 })] }),
    sim('EnergyToday', 'counter', 0, 1e9, { step: 0.03, unit: 'kWh', decimals: 1 }),
    ...LOADS.map((l, i) => sim(l, 'randomWalk', 2 + i, 18 + i * 6, { unit: 'kW', step: 0.8, decimals: 1 })),
  ]),
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title, { process: 'Main incomer', trend: 'Demand — 30 min', controls: 'Sub-meters' });
    [1, 2, 3].forEach((l, i) => {
      p.add('gauge', 50 + i * 230, 100, 200, 180, { tag: p.t(`VoltageL${l}`), min: 200, max: 250, label: `L${l} voltage`, zones: '200:#f59e0b,215:#22c55e,236:#ef4444' });
      p.add('bar', 120 + i * 230, 300, 60, 200, { tag: p.t(`CurrentL${l}`), min: 0, max: 300, color: '#38bdf8' });
      p.text(80 + i * 230, 506, 140, `L${l} current`, 12, { align: 'center' });
    });
    p.add('gauge', 760, 100, 200, 180, { tag: p.t('PowerFactor'), min: 0.7, max: 1, label: 'Power factor', decimals: 2, zones: '0.7:#ef4444,0.88:#f59e0b,0.95:#22c55e' });
    p.value(740, 310, 300, 'ActivePower', 'Active power', { fontSize: 20 });
    p.value(740, 360, 300, 'Frequency', 'Frequency', { fontSize: 20 });
    p.value(740, 410, 300, 'EnergyToday', 'Energy today', { fontSize: 20 });
    p.add('sparkline', 740, 470, 300, 80, { tag: p.t('ActivePower'), color: '#f97316' });
    p.add('gauge', 1104, 90, 150, 136, { tag: p.t('ActivePower'), min: 0, max: 200, label: 'Demand kW', decimals: 0, zones: '0:#22c55e,120:#f59e0b,140:#ef4444' });
    p.add('gauge', 1262, 90, 150, 136, { tag: p.t('Frequency'), min: 49.5, max: 50.5, label: 'Hz', decimals: 2, zones: '49.5:#ef4444,49.8:#22c55e,50.2:#ef4444' });
    p.add('gauge', 1420, 90, 150, 136, { tag: p.t('PowerFactor'), min: 0.7, max: 1, label: 'cos φ', decimals: 2, zones: '0.7:#ef4444,0.88:#f59e0b,0.95:#22c55e' });
    p.value(1104, 250, 468, 'EnergyToday', 'Energy today');
    p.add('trend', 1104, 356, 468, 258, { tags: ['ActivePower', ...LOADS.slice(0, 3)].map((t) => p.t(t)).join(','), minutes: 30 });
    p.add('alarmTable', 16, 638, 1064, 248, { area: base, maxRows: 8 });
    p.add('barChart', 1106, 672, 466, 206, { tags: LOADS.map((l) => p.t(l)).join(','), labels: 'HVAC,Light,Prod.,Office,EV', max: 50, decimals: 1, color: '#a78bfa' });
    return p.build({ title, width: 1600, height: 900 });
  },
};

// ═══════════════════════════════ HOME: mobile remote ═══════════════════════════════
const ROOMS_HOME = ['Living', 'Kitchen', 'Bedroom', 'Porch'];
const homeRemote: PageTemplate = {
  id: 'home-mobile',
  name: 'Smart home — phone remote',
  category: 'Home',
  description: 'Phone-first portrait page (420×900): big touch switches for lights, thermostat, garage, alarm arming and live energy — add it to your home screen.',
  defaultName: 'MyHome',
  size: 'phone',
  features: ['Touch-friendly controls', 'Thermostat with setpoint', 'Arm/disarm & garage with confirmation'],
  nodes: (name) => simDevice(name, [
    ...ROOMS_HOME.map((r) => mem(`${r}Light`, false, { history: true })),
    sim('Temperature', 'sine', 19, 24, { unit: '°C', period: 900, decimals: 1 }),
    mem('Setpoint', 21, { unit: '°C', min: 15, max: 27, decimals: 1 }),
    calc('Heating', "tag('./Temperature') < tag('./Setpoint') - 0.3", { dataType: 'boolean' }),
    mem('Garage', false),
    mem('AlarmArmed', false),
    sim('FrontDoor', 'toggle', 0, 1, { period: 300, history: false }),
    sim('Power', 'randomWalk', 150, 4200, { unit: 'W', step: 120, decimals: 0 }),
  ]),
  display: (base, title) => {
    const p = new Page(base);
    const W = PAGE_SIZES.phone.width;
    p.header(title, W);
    p.add('clock', 24, 50, 200, 26, { format: 'datetime', fontSize: 12, color: COLORS.dim });
    p.panel(12, 86, W - 24, 230, 'Climate');
    p.add('thermostat', 24, 110, 190, 190, { min: 14, max: 28 }, { bindings: { value: B(p.t('Temperature')), setpoint: B(p.t('Setpoint')), heating: B(p.t('Heating')) } });
    p.add('button', 236, 130, 160, 56, { text: '＋ warmer', fontSize: 18, color: '#c2410c' }, { events: { click: `await tags.write('${p.t('Setpoint')}', Math.min(27, tags.get('${p.t('Setpoint')}') + 0.5));` } });
    p.add('button', 236, 196, 160, 56, { text: '－ cooler', fontSize: 18, color: '#1d4ed8' }, { events: { click: `await tags.write('${p.t('Setpoint')}', Math.max(15, tags.get('${p.t('Setpoint')}') - 0.5));` } });
    p.add('value', 236, 262, 160, 36, { tag: p.t('Setpoint'), label: 'Set', fontSize: 16 });
    p.panel(12, 328, W - 24, 250, 'Lights');
    ROOMS_HOME.forEach((r, i) => {
      const x = 24 + (i % 2) * 196;
      const y = 360 + Math.floor(i / 2) * 104;
      p.add('lamp', x, y, 50, 60, {}, { bindings: { on: B(p.t(`${r}Light`)) } });
      p.add('switch', x + 56, y + 14, 130, 36, { tag: p.t(`${r}Light`), label: r, fontSize: 15 });
    });
    p.add('button', 24, 566 - 40, W - 48, 40, { text: 'All lights off', color: '#334155', fontSize: 15 },
      { events: { click: `await tags.writeMany({ ${ROOMS_HOME.map((r) => `'${p.t(`${r}Light`)}': false`).join(', ')} });\nui.toast('Lights off', 'success');` } });
    p.panel(12, 590, W - 24, 160, 'Security');
    p.add('door', 30, 620, 56, 84, {}, { bindings: { open: B(p.t('FrontDoor')) } });
    p.text(20, 708, 80, 'Front door', 11, { align: 'center' });
    p.add('button', 110, 622, 286, 50, { text: 'Garage', action: 'toggle', tag: p.t('Garage'), color: '#334155', activeColor: '#c2410c', confirm: true, fontSize: 17 });
    p.add('button', 110, 682, 286, 50, { text: 'Alarm armed', action: 'toggle', tag: p.t('AlarmArmed'), color: '#334155', activeColor: '#7c3aed', confirm: true, fontSize: 17 });
    p.panel(12, 762, W - 24, 126, 'Energy');
    p.add('value', 24, 792, W - 48, 40, { tag: p.t('Power'), label: 'Using now', fontSize: 20 });
    p.add('sparkline', 24, 836, W - 48, 44, { tag: p.t('Power'), color: '#f97316', decimals: 0 });
    return p.build({ title, width: W, height: PAGE_SIZES.phone.height, background: '#0b1118' });
  },
};

// ═══════════════════════════════ layouts (no tags) ═══════════════════════════════
const blank = (id: string, size: keyof typeof PAGE_SIZES, name: string, description: string): PageTemplate => ({
  id, name, category: 'Layout', description, defaultName: name.replace(/\W+/g, ''), size,
  display: (base, title) => {
    const { width, height } = PAGE_SIZES[size];
    const p = new Page(base);
    if (size !== 'faceplate') p.header(title, width);
    else p.text(16, 8, width - 32, '{$path}', 15, { fontWeight: '700', color: COLORS.text, mono: true });
    return p.build({ title, width, height, kind: size === 'faceplate' ? 'faceplate' : 'page', ...(size === 'faceplate' && { background: COLORS.panel }) });
  },
});

const dashboardLayout: PageTemplate = {
  id: 'layout-dashboard', name: 'Dashboard skeleton', category: 'Layout', size: 'desktop', defaultName: 'Dashboard',
  description: 'Header + process area + KPI, trend, controls and alarm panels — the ISA-101 level-2 layout used by every use case.',
  display: (base, title) => {
    const p = new Page(base);
    desktopFrame(p, title);
    p.add('alarmTable', 16, 638, 1064, 248, { area: '', maxRows: 8 });
    return p.build({ title, width: 1600, height: 900 });
  },
};

export const TEMPLATES: PageTemplate[] = [
  pumpStation, ahu, solar, boilerRoom, tankFarm, coldStore, greenhouse, packagingLine, energyMeter, homeRemote,
  dashboardLayout,
  blank('blank-desktop', 'desktop', 'Blank desktop page', 'Empty 1600×900 page with header and clock.'),
  blank('blank-tablet', 'tablet', 'Blank tablet page', 'Empty 1180×820 page sized for iPad landscape.'),
  blank('blank-phone', 'phone', 'Blank phone page', 'Empty 420×900 portrait page for phones.'),
  blank('blank-faceplate', 'faceplate', 'Faceplate template', 'Parameterised 520×400 faceplate — bind to {$path}/… and open it from any symbol.'),
];
