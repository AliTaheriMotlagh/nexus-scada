import { connect, type MqttClient } from 'mqtt';
import { errorMessage, getJsonPath, renderTemplate } from '../core/util.ts';
import type { TagRuntime } from '../tags/TagEngine.ts';
import { num, src, str, type Driver, type DriverContext } from './Driver.ts';

/** MQTT topic filter matching with + and # wildcards. */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function parsePayload(buf: Buffer): unknown {
  const text = buf.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * MQTT device — home automation and IIoT (Zigbee2MQTT, Tasmota, Shelly, ESPHome, Home Assistant, Sparkplug-like JSON).
 * settings: { url: mqtt://host:1883, username, password, clientId, qos }
 * tag source: { topic, path (json path), writeTopic, writeTemplate ('{"state":"{{value}}"}'), onValue: "ON", offValue: "OFF", retain }
 */
export function createMqttDriver(ctx: DriverContext): Driver {
  const url = str(ctx.settings.url, 'mqtt://localhost:1883');
  const qos = num(ctx.settings.qos, 0) as 0 | 1 | 2;
  let client: MqttClient | undefined;

  const subscriptions = new Map<string, TagRuntime[]>();
  for (const tag of ctx.device.tags) {
    const topic = str(src(tag).topic);
    if (!topic) continue;
    if (!subscriptions.has(topic)) subscriptions.set(topic, []);
    subscriptions.get(topic)!.push(tag);
  }

  const fromPayload = (tag: TagRuntime, payload: unknown): unknown => {
    const s = src(tag);
    let v = getJsonPath(payload, s.path as string | undefined);
    if (tag.dataType === 'boolean' && s.onValue !== undefined) v = String(v) === String(s.onValue);
    return v;
  };

  const toPayload = (tag: TagRuntime, value: unknown): string => {
    const s = src(tag);
    let v = value;
    if (tag.dataType === 'boolean' && s.onValue !== undefined) v = value ? s.onValue : s.offValue;
    if (typeof s.writeTemplate === 'string') return renderTemplate(s.writeTemplate, v);
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };

  return {
    start() {
      ctx.status('connecting', url);
      client = connect(url, {
        username: ctx.settings.username as string | undefined,
        password: ctx.settings.password as string | undefined,
        clientId: str(ctx.settings.clientId, `nexus-${Math.random().toString(16).slice(2, 10)}`),
        reconnectPeriod: 3000,
        connectTimeout: 10000,
      });
      client.on('connect', () => {
        ctx.status('connected', url);
        if (subscriptions.size) client!.subscribe([...subscriptions.keys()], { qos });
      });
      client.on('reconnect', () => ctx.status('connecting', `reconnecting to ${url}`));
      client.on('offline', () => {
        ctx.setQuality('bad');
        ctx.status('error', 'offline');
      });
      client.on('error', (err) => {
        ctx.countError();
        ctx.status('error', errorMessage(err));
      });
      client.on('message', (topic, buf) => {
        const payload = parsePayload(buf);
        for (const [filter, tags] of subscriptions) {
          if (!topicMatches(filter, topic)) continue;
          for (const tag of tags) {
            const v = fromPayload(tag, payload);
            if (v !== undefined) ctx.update(tag.path, v);
          }
          ctx.countRead(tags.length);
        }
      });
    },
    stop() {
      client?.end(true);
    },
    async write(tag, value) {
      if (!client?.connected) throw new Error('MQTT broker not connected');
      const s = src(tag);
      const topic = str(s.writeTopic, str(s.topic));
      await client.publishAsync(topic, toPayload(tag, value), { qos, retain: s.retain === true });
      ctx.countWrite();
      // Optimistic update when the device does not echo state on the same topic.
      if (s.writeTopic) ctx.update(tag.path, value);
    },
    async publish(topic, payload, options) {
      if (!client?.connected) throw new Error('MQTT broker not connected');
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      await client.publishAsync(topic, text, { qos: options?.qos ?? qos, retain: options?.retain ?? false });
      ctx.countWrite();
    },
  };
}
