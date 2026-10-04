// Hourly KPI report stored in a custom table (trigger: cron "0 * * * *" or manual run).
db.exec(`CREATE TABLE IF NOT EXISTS kpi_report (
  ts INTEGER NOT NULL, tag TEXT NOT NULL, average REAL
)`);

const kpis = ['Plant/Area1/Tank1/Level', 'Plant/Area1/Pressure', 'Plant/Area1/Flow', 'Home/Sensors/Power'];
const now = Date.now();

for (const path of kpis) {
  const avg = await history.average(path, 3600);
  db.exec('INSERT INTO kpi_report (ts, tag, average) VALUES (?, ?, ?)', now, path, avg);
  log.info(`${path}: 1 h average = ${avg === null ? 'n/a' : avg.toFixed(2)}`);
}

const rows = db.query<{ n: number }>('SELECT count(*) AS n FROM kpi_report');
log.info(`kpi_report now has ${rows[0].n} rows`);
