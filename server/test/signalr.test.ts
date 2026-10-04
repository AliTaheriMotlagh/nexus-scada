import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import WebSocket from 'ws';
import { HubException, SignalRHubServer } from '../src/realtime/SignalRServer.ts';

const RS = '\u001e';

/** Protocol-level test of the SignalR hub server (JSON protocol over WebSockets). */
describe('SignalR hub protocol', () => {
  const app = express();
  const server = createServer(app);
  let hub: SignalRHubServer;
  let base = '';

  before(async () => {
    hub = new SignalRHubServer('/hubs/test', app, server, {
      methods: {
        add: (_c, a: number, b: number) => a + b,
        whoAmI: (c) => c.user?.username ?? null,
        fail: () => { throw new HubException('nope'); },
      },
      onConnected: (c) => c.send('welcome', 'hi'),
    }, (token) => (token === 'good' ? { username: 'u1', role: 'operator' } : undefined));
    await new Promise<void>((r) => server.listen(0, r));
    base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    hub.close();
    server.close();
  });

  it('negotiates, handshakes, invokes and pushes', async () => {
    const neg = (await (await fetch(`http://${base}/hubs/test/negotiate?negotiateVersion=1`, { method: 'POST', headers: { authorization: 'Bearer good' } })).json()) as { negotiateVersion: number; connectionToken: string; availableTransports: { transport: string }[] };
    assert.equal(neg.negotiateVersion, 1);
    assert.equal(neg.availableTransports[0].transport, 'WebSockets');

    const ws = new WebSocket(`ws://${base}/hubs/test?id=${neg.connectionToken}`);
    const frames: Record<string, unknown>[] = [];
    let handshake = false;
    const waitFor = (pred: (m: Record<string, unknown>) => boolean) => new Promise<Record<string, unknown>>((resolve) => {
      const check = () => {
        const f = frames.find(pred);
        if (f) resolve(f);
        else setTimeout(check, 10);
      };
      check();
    });
    ws.on('message', (d) => {
      for (const part of d.toString().split(RS).filter(Boolean)) {
        const m = JSON.parse(part);
        if (!handshake && Object.keys(m).length === 0) handshake = true;
        else frames.push(m);
      }
    });
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);

    const welcome = await waitFor((m) => m.target === 'welcome');
    assert.deepEqual(welcome.arguments, ['hi']);
    assert.ok(handshake);

    ws.send(JSON.stringify({ type: 1, invocationId: '1', target: 'Add', arguments: [2, 3] }) + RS);
    assert.equal((await waitFor((m) => m.invocationId === '1')).result, 5);

    ws.send(JSON.stringify({ type: 1, invocationId: '2', target: 'whoAmI', arguments: [] }) + RS);
    assert.equal((await waitFor((m) => m.invocationId === '2')).result, 'u1');

    ws.send(JSON.stringify({ type: 1, invocationId: '3', target: 'fail', arguments: [] }) + RS);
    assert.equal((await waitFor((m) => m.invocationId === '3')).error, 'nope');

    ws.send(JSON.stringify({ type: 1, invocationId: '4', target: 'missing', arguments: [] }) + RS);
    assert.match(String((await waitFor((m) => m.invocationId === '4')).error), /Unknown hub method/);

    hub.clients.all.send('broadcast', { x: 1 });
    assert.deepEqual((await waitFor((m) => m.target === 'broadcast')).arguments, [{ x: 1 }]);
    ws.close();
  });

  it('rejects unknown connection tokens', async () => {
    const ws = new WebSocket(`ws://${base}/hubs/test?id=bogus`);
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    assert.equal(code, 1008);
  });
});
