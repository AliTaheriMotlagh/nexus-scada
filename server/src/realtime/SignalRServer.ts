import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Express, Request } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import type { SessionUser } from '../../../shared/types.ts';
import { createLogger } from '../core/logger.ts';
import { errorMessage } from '../core/util.ts';

/**
 * Server-side implementation of the ASP.NET Core SignalR hub protocol (JSON, version 1)
 * over the WebSockets transport. The stock `@microsoft/signalr` client connects to it unchanged,
 * so the hub could be swapped for an ASP.NET Core backend without touching the UI.
 *
 * Protocol: https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/HubProtocol.md
 */

const RS = '\u001e';
const MessageType = { Invocation: 1, StreamItem: 2, Completion: 3, StreamInvocation: 4, CancelInvocation: 5, Ping: 6, Close: 7 } as const;
const PING_MS = 15_000;
const CLIENT_TIMEOUT_MS = 60_000;
const MAX_BUFFERED = 16 * 1024 * 1024;

const log = createLogger('signalr');

/** Error whose message is sent to the caller (other errors are masked). */
export class HubException extends Error {}

export interface HubConnection {
  readonly id: string;
  readonly user: SessionUser | undefined;
  /** Per-connection state bag (e.g. subscriptions). */
  readonly items: Map<string, unknown>;
  send(target: string, ...args: unknown[]): void;
  close(error?: string): void;
}

export type HubMethod = (conn: HubConnection, ...args: never[]) => unknown;

export interface HubDefinition {
  methods: Record<string, HubMethod>;
  onConnected?(conn: HubConnection): void;
  onDisconnected?(conn: HubConnection): void;
}

export interface HubClients {
  all: { send(target: string, ...args: unknown[]): void };
  group(name: string): { send(target: string, ...args: unknown[]): void };
  connections(): Iterable<HubConnection>;
  addToGroup(connectionId: string, group: string): void;
  removeFromGroup(connectionId: string, group: string): void;
}

class Connection implements HubConnection {
  readonly id: string;
  readonly user: SessionUser | undefined;
  readonly items = new Map<string, unknown>();
  readonly ws: WebSocket;
  handshakeDone = false;
  lastSeen = Date.now();

  constructor(id: string, ws: WebSocket, user: SessionUser | undefined) {
    this.id = id;
    this.ws = ws;
    this.user = user;
  }

  write(msg: object): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED) {
      log.warn(`connection ${this.id} is too slow, closing`);
      this.close('Client too slow');
      return;
    }
    this.ws.send(JSON.stringify(msg) + RS);
  }

  send(target: string, ...args: unknown[]): void {
    if (this.handshakeDone) this.write({ type: MessageType.Invocation, target, arguments: args });
  }

  close(error?: string): void {
    this.write({ type: MessageType.Close, error, allowReconnect: true });
    this.ws.close();
  }
}

export class SignalRHubServer {
  private readonly hub: HubDefinition;
  private readonly methods: Map<string, HubMethod>;
  private readonly authenticate: (token: string | undefined) => SessionUser | undefined;
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  private readonly connections = new Map<string, Connection>();
  private readonly pendingTokens = new Map<string, { user?: SessionUser; expires: number }>();
  private readonly groups = new Map<string, Set<string>>();
  private readonly timer: NodeJS.Timeout;
  readonly clients: HubClients;

  constructor(
    path: string,
    app: Express,
    server: Server,
    hub: HubDefinition,
    authenticate: (token: string | undefined) => SessionUser | undefined,
  ) {
    this.hub = hub;
    this.authenticate = authenticate;
    this.methods = new Map(Object.entries(hub.methods).map(([k, v]) => [k.toLowerCase(), v]));

    // 1) Negotiate: hand out a connection token; we only offer WebSockets.
    app.post(`${path}/negotiate`, (req: Request, res) => {
      const connectionToken = randomBytes(16).toString('base64url');
      const connectionId = randomBytes(12).toString('base64url');
      const user = authenticate(bearer(req.headers.authorization) ?? (req.query.access_token as string | undefined));
      this.pendingTokens.set(connectionToken, { user, expires: Date.now() + 30_000 });
      res.json({
        connectionId,
        connectionToken,
        negotiateVersion: 1,
        availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text'] }],
      });
    });

    // 2) WebSocket upgrade on the hub path.
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== path) return;
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, req, url));
    });

    this.timer = setInterval(() => this.keepAlive(), PING_MS);

    this.clients = {
      all: { send: (target, ...args) => { for (const c of this.connections.values()) c.send(target, ...args); } },
      group: (name) => ({
        send: (target, ...args) => {
          for (const id of this.groups.get(name) ?? []) this.connections.get(id)?.send(target, ...args);
        },
      }),
      connections: () => this.connections.values(),
      addToGroup: (id, group) => {
        if (!this.groups.has(group)) this.groups.set(group, new Set());
        this.groups.get(group)!.add(id);
      },
      removeFromGroup: (id, group) => { this.groups.get(group)?.delete(id); },
    };
  }

  private accept(ws: WebSocket, req: IncomingMessage, url: URL): void {
    const token = url.searchParams.get('id');
    const pending = token ? this.pendingTokens.get(token) : undefined;
    if (token) this.pendingTokens.delete(token);
    if (token && (!pending || pending.expires < Date.now())) {
      ws.close(1008, 'Unknown or expired connection token');
      return;
    }
    // skipNegotiation clients pass the token as access_token on the socket URL.
    const user = pending?.user ?? this.authenticate(url.searchParams.get('access_token') ?? bearer(req.headers.authorization));
    const conn = new Connection(token ?? randomBytes(12).toString('base64url'), ws, user);
    this.connections.set(conn.id, conn);

    let buffer = '';
    ws.on('message', (data) => {
      conn.lastSeen = Date.now();
      buffer += data.toString();
      let idx: number;
      while ((idx = buffer.indexOf(RS)) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        this.onFrame(conn, frame);
      }
    });
    ws.on('close', () => this.drop(conn));
    ws.on('error', (err) => log.debug(`socket error ${conn.id}: ${err.message}`));
  }

  private onFrame(conn: Connection, frame: string): void {
    let msg: { type?: number; protocol?: string; version?: number; invocationId?: string; target?: string; arguments?: unknown[] };
    try {
      msg = JSON.parse(frame);
    } catch {
      conn.close('Invalid JSON');
      return;
    }

    if (!conn.handshakeDone) {
      if (msg.protocol !== 'json') {
        conn.ws.send(JSON.stringify({ error: `Protocol "${msg.protocol}" is not supported, use "json"` }) + RS);
        conn.ws.close();
        return;
      }
      conn.ws.send('{}' + RS);
      conn.handshakeDone = true;
      try {
        this.hub.onConnected?.(conn);
      } catch (err) {
        log.error('onConnected failed:', err);
      }
      return;
    }

    switch (msg.type) {
      case MessageType.Invocation:
        void this.invoke(conn, msg.invocationId, msg.target ?? '', msg.arguments ?? []);
        break;
      case MessageType.Ping:
        break;
      case MessageType.Close:
        conn.ws.close();
        break;
      case MessageType.StreamInvocation:
        conn.write({ type: MessageType.Completion, invocationId: msg.invocationId, error: 'Streaming is not supported' });
        break;
      default:
        break;
    }
  }

  private async invoke(conn: Connection, invocationId: string | undefined, target: string, args: unknown[]): Promise<void> {
    const method = this.methods.get(target.toLowerCase());
    try {
      if (!method) throw new HubException(`Unknown hub method '${target}'`);
      const result = await (method as (c: HubConnection, ...a: unknown[]) => unknown)(conn, ...args);
      if (invocationId !== undefined) conn.write({ type: MessageType.Completion, invocationId, result: result ?? null });
    } catch (err) {
      const status = (err as { status?: number }).status;
      const exposed = err instanceof HubException || status !== undefined;
      if (!exposed) log.error(`hub method ${target} failed:`, err);
      if (invocationId !== undefined) {
        conn.write({ type: MessageType.Completion, invocationId, error: exposed ? errorMessage(err) : `An unexpected error occurred invoking '${target}' on the server.` });
      }
    }
  }

  private keepAlive(): void {
    const now = Date.now();
    for (const conn of this.connections.values()) {
      if (now - conn.lastSeen > CLIENT_TIMEOUT_MS) {
        conn.close('Server timeout elapsed without receiving a message from the client.');
        continue;
      }
      if (conn.handshakeDone) conn.write({ type: MessageType.Ping });
    }
    for (const [t, p] of this.pendingTokens) if (p.expires < now) this.pendingTokens.delete(t);
  }

  private drop(conn: Connection): void {
    if (!this.connections.delete(conn.id)) return;
    for (const members of this.groups.values()) members.delete(conn.id);
    try {
      this.hub.onDisconnected?.(conn);
    } catch (err) {
      log.error('onDisconnected failed:', err);
    }
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  close(): void {
    clearInterval(this.timer);
    for (const c of this.connections.values()) c.close('Server shutting down');
    this.wss.close();
  }
}

function bearer(header: string | undefined): string | undefined {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}
