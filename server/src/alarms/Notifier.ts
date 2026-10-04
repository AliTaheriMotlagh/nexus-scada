import { SEVERITY_RANK, type AlarmEvent, type NotificationChannel, type Severity } from '../../../shared/types.ts';
import type { EventBus } from '../core/EventBus.ts';
import { createLogger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';

const log = createLogger('notify');
const NTFY_PRIORITY: Record<Severity, string> = { critical: '5', high: '4', medium: '3', low: '2', info: '1' };

export interface Notification {
  title: string;
  message: string;
  severity: Severity;
  data?: unknown;
}

/** Sends alarm and script notifications to phones and chat (ntfy, Telegram, Slack, Discord, generic webhooks). */
export class Notifier {
  private channels: NotificationChannel[] = [];

  constructor(bus: EventBus) {
    bus.on('alarm:event', (ev) => {
      if (ev.event === 'active') void this.onAlarm(ev);
    });
  }

  load(channels: NotificationChannel[] = []): void {
    this.channels = channels.filter((c) => c.enabled !== false);
  }

  private async onAlarm(ev: AlarmEvent): Promise<void> {
    const n: Notification = { title: `${ev.severity.toUpperCase()} alarm`, message: ev.message, severity: ev.severity, data: ev };
    await Promise.all(
      this.channels
        .filter((c) => SEVERITY_RANK[ev.severity] >= SEVERITY_RANK[c.minSeverity ?? 'high'])
        .map((c) => this.send(c, n)),
    );
  }

  async notify(n: Notification, channel?: string): Promise<void> {
    const targets = channel ? this.channels.filter((c) => c.name === channel) : this.channels;
    if (channel && !targets.length) throw new Error(`Unknown notification channel "${channel}"`);
    await Promise.all(targets.map((c) => this.send(c, n)));
  }

  private async send(c: NotificationChannel, n: Notification): Promise<void> {
    try {
      let res: Response;
      const signal = AbortSignal.timeout(8000);
      switch (c.type) {
        case 'ntfy':
          res = await fetch(c.url!, { method: 'POST', body: n.message, headers: { Title: n.title, Priority: NTFY_PRIORITY[n.severity], Tags: 'warning' }, signal });
          break;
        case 'telegram':
          res = await fetch(`https://api.telegram.org/bot${c.token}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, signal,
            body: JSON.stringify({ chat_id: c.chatId, text: `*${n.title}*\n${n.message}`, parse_mode: 'Markdown' }),
          });
          break;
        case 'slack':
          res = await fetch(c.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${n.title}*: ${n.message}` }), signal });
          break;
        case 'discord':
          res = await fetch(c.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${n.title}**: ${n.message}` }), signal });
          break;
        default:
          res = await fetch(c.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(n), signal });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      log.warn(`channel ${c.name} failed: ${errorMessage(err)}`);
    }
  }
}
