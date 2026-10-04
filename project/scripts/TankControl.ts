// Automatic level control (trigger: tag change of Level / Mode).
// Hysteresis band of ±8 % around the setpoint.
const tank = event.path!.split('/').slice(0, 3).join('/'); // e.g. Plant/Area1/Tank1
if (tags.get(`${tank}/Mode`) !== 'Auto') return;

const level: number = tags.get(`${tank}/Level`);
const setpoint: number = tags.get(`${tank}/Setpoint`);
const inlet: boolean = tags.get(`${tank}/InletValve`);

if (level < setpoint - 8 && !inlet) {
  await tags.write(`${tank}/InletValve`, true);
  log.info(`${tank}: level ${level.toFixed(1)}% < ${setpoint - 8}% → inlet OPEN`);
} else if (level > setpoint + 8 && inlet) {
  await tags.write(`${tank}/InletValve`, false);
  log.info(`${tank}: level ${level.toFixed(1)}% > ${setpoint + 8}% → inlet CLOSED`);
}

if (!tags.get(`${tank}/Pump/Running`) && level > 10) {
  await tags.write(`${tank}/Pump/Running`, true);
}
