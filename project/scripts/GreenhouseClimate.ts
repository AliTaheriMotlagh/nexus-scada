// Greenhouse model and automatic control
const B = 'Sites/Greenhouse';
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
