// Steam header model with proportional burner modulation and lead/lag boiler firing
const B = 'Sites/BoilerHouse';
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
