// Self-consumption: charge from PV surplus, discharge to cover the load above the reserve.
const B = 'Sites/SolarPlant';
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
