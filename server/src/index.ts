import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { createApi, errorHandler } from './api/routes.ts';
import { createLogger } from './core/logger.ts';
import { attachBroadcasts, createRuntimeHub } from './realtime/RuntimeHub.ts';
import { SignalRHubServer } from './realtime/SignalRServer.ts';
import { Runtime } from './Runtime.ts';

const log = createLogger('server');
const repoRoot = resolve(import.meta.dirname, '../..');
const projectDir = resolve(process.env.NEXUS_PROJECT_DIR ?? `${repoRoot}/project`);
const dataDir = resolve(process.env.NEXUS_DATA_DIR ?? `${repoRoot}/data`);
const clientDist = resolve(process.env.NEXUS_CLIENT_DIR ?? `${repoRoot}/client/dist`);

const runtime = new Runtime({ projectDir, dataDir });
await runtime.start();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: ['text/plain', 'text/yaml', 'application/yaml'], limit: '10mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use('/api', createApi(runtime));

const server = createServer(app);
let hub: SignalRHubServer | undefined;
hub = new SignalRHubServer(
  '/hubs/runtime',
  app,
  server,
  createRuntimeHub(runtime, () => hub!.clients),
  (token) => runtime.auth.verify(token),
);
const detach = attachBroadcasts(runtime, hub.clients);

// Production: serve the built client (single-page app).
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api|\/hubs).*/, (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
} else {
  log.warn(`client build not found at ${clientDist} — run "npm run build" or use "npm run dev"`);
}
app.use(errorHandler);

const port = Number(process.env.PORT ?? runtime.config.server?.port ?? 8080);
server.listen(port, () => {
  log.info(`Nexus SCADA listening on http://localhost:${port}  (project: ${projectDir})`);
});

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info(`${signal} received, shutting down`);
  detach();
  hub?.close();
  server.close();
  await runtime.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
