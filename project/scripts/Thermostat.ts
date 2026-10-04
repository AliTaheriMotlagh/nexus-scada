// Home heating control (trigger: every 5 s and on setpoint / away-mode change).
const temp: number = tags.get('Home/Sensors/LivingRoomTemp');
const setpoint: number = tags.get('Home/Devices/ThermostatSetpoint');
const away: boolean = tags.get('Home/Devices/AwayMode');
const heating: boolean = tags.get('Home/Devices/Heating');

const target = away ? setpoint - 3 : setpoint; // eco temperature while away
const hysteresis = 0.4;

if (!heating && temp < target - hysteresis) {
  await tags.write('Home/Devices/Heating', true);
  log.info(`Heating ON  (${temp.toFixed(1)} °C < ${target.toFixed(1)} °C)`);
} else if (heating && temp > target + hysteresis) {
  await tags.write('Home/Devices/Heating', false);
  log.info(`Heating OFF (${temp.toFixed(1)} °C > ${target.toFixed(1)} °C)`);
}
