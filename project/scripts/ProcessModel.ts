// Simple mass-balance model for both tanks (trigger: every 500 ms).
// Inflow when the inlet valve is open, outflow proportional to pump speed.
const dt = 0.5; // seconds

for (const tank of ['Tank1', 'Tank2']) {
  const base = `Plant/Area1/${tank}`;
  const level: number = tags.get(`${base}/Level`);
  const inletOpen: boolean = tags.get(`${base}/InletValve`);
  const pumpOn: boolean = tags.get(`${base}/Pump/Running`);
  const speed: number = tags.get(`${base}/Pump/Speed`);
  const estop: boolean = tags.get('Plant/Area1/EmergencyStop');

  const inflow = inletOpen && !estop ? 2.2 : 0;          // % per second
  const outflow = pumpOn && !estop ? 0.03 * speed : 0;    // % per second
  const next = Math.min(100, Math.max(0, level + (inflow - outflow) * dt));

  if (Math.abs(next - level) >= 0.01) {
    await tags.write(`${base}/Level`, Math.round(next * 100) / 100);
  }
}
