// Push critical alarms to phones / chat (trigger: alarm, minSeverity critical).
// Configure channels under `notifications:` in project.yaml (ntfy, telegram, slack, discord, webhook).
const alarm = event.alarm;
log.warn(`CRITICAL: ${alarm.message} (${alarm.tag})`);

try {
  await notify(alarm.message, { title: 'Critical alarm', severity: 'critical' });
} catch (err) {
  log.error('notification failed', err);
}
