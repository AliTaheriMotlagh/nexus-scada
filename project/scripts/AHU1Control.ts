// Supply-air temperature control (sequenced heat/cool) + demand-controlled ventilation
const B = 'Sites/AHU1';
const running: boolean = tags.get(B + '/SupplyFan');
const error = tags.get(B + '/SupplySetpoint') - tags.get(B + '/SupplyTemp');
let heat: number = tags.get(B + '/HeatingValve');
let cool: number = tags.get(B + '/CoolingValve');
if (!running) { heat = 0; cool = 0; }
else if (error > 0.3) { if (cool > 0) cool = Math.max(0, cool - 5); else heat = Math.min(100, heat + Math.min(8, error * 3)); }
else if (error < -0.3) { if (heat > 0) heat = Math.max(0, heat - 5); else cool = Math.min(100, cool - Math.max(-8, error * 3)); }
const damper = Math.min(100, Math.max(15, (tags.get(B + '/CO2') - 450) / 7));
await tags.writeMany({ [B + '/HeatingValve']: Math.round(heat), [B + '/CoolingValve']: Math.round(cool), [B + '/OADamper']: Math.round(damper) });
