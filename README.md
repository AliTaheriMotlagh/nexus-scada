# Nexus SCADA

A full-stack **HMI / SCADA and home-automation platform written entirely in TypeScript**.
One process serves the web HMI, the REST API and a **SignalR** real-time hub. It runs the tag engine, drivers, alarms, historian, scripts and scheduler.
Everything is configured as code in **YAML** and hot-reloads.

```
npm install && npm run build && npm start     →  http://localhost:8080
docker compose up -d                          →  http://localhost:8080
```

Demo users: `admin/admin`, `engineer/engineer`, `operator/operator` (anonymous visitors get read-only `viewer`).

---

## Features

| Area | What you get |
|---|---|
| **Runtime (SignalR)** | ASP.NET Core SignalR JSON hub protocol implemented in Node (negotiate, WebSockets, handshake, invocations, pings, groups). The stock `@microsoft/signalr` client connects, and you could swap the server for ASP.NET Core without touching the UI. Values are pushed in batches every 100 ms, only for the tags each client subscribed to. |
| **Node tree** | `Folder → Device → Folder → Tag` hierarchy. Tag paths follow the tree, e.g. `Plant/Area1/Tank1/Level`. A tree view is used everywhere: project nodes, displays, scenes, scripts, symbol palette, layers, tag picker, trends. |
| **Drivers** | `simulation` (sine, ramp, triangle, square, toggle, random, randomWalk, counter, clock), `memory`, `modbus-tcp` (block-optimised, int16/32, float32, word swap, scaling), `mqtt` (Zigbee2MQTT, Tasmota, Shelly, ESPHome), `rest` (Home Assistant, Hue, web APIs), `sql`. Reconnect with exponential back-off and per-device diagnostics. |
| **Tags** | Number, boolean, string or JSON. Quality and timestamp, engineering limits, deadband, write roles, state texts, and **calculated tags** written as TypeScript expressions with relative paths (`tag('./Speed') * 0.18`). |
| **Alarms** | ISA-18.2-style state machine: HiHi/Hi/Lo/LoLo, on/off, equals and bad-quality alarms. Supports deadband, on-delay, priorities, acknowledge with comment, shelving with expiry, and an event journal. Includes an alarm bar with a horn and silence button, an alarm viewer (active, shelved, history), an embeddable alarm widget, and colour-coded map sites. |
| **Historian** | SQLite. Stores on change with deadband plus heartbeat samples, aggregates min/avg/max buckets for long ranges, applies retention, and exports CSV. |
| **Trends** | uPlot: live and historical modes, one Y axis per unit, drag to zoom, cursor sync, up to 10 pens, CSV export. |
| **Graphics designer** | Drag and drop, move, resize, rotate, marquee select, snap to grid, zoom, align and distribute, z-order, group and ungroup, copy and paste, undo and redo, layers, JSON import and export, and live preview. Drop a tag on the canvas to create a control, or on an element to animate it. |
| **Symbols** | Process: tank, silo, pump, valve, motor, fan, compressor, conveyor, heat exchanger, boiler, ISA instrument, flowing pipe. 3D-shaded: cylinder, cube, sphere, cone. Home and IoT: bulb, thermostat, door, solar panel, battery, smart plug, house, alarm beacon. |
| **Web controls** | Button (write, toggle, pulse, navigate, faceplate, scene, script; optional confirmation), switch, slider, numeric input, text input, dropdown, checkbox, gauge, bar, LED, value display, multi-state, progress, clock, trend, sparkline, bar chart, alarm list, web frame, embedded 3D viewport. |
| **Animation** | Any property can be bound to a tag, a **TypeScript expression**, or **value-map rules** (`>80 → red`, `10..20`, `Running`, `default`). This includes visibility, blink, opacity, rotation and x/y movement. |
| **Faceplates** | Auto-generated generic faceplates (tags, operator controls, mini trend, alarms) or **parameterised templates** (`{$path}`), opened as draggable windows. |
| **3D** | React Three Fiber scenes with tank, pump, pipe flow, valve, motor, fan, conveyor, house, lamp, primitives and glTF models. Live bindings, clickable faceplates, an editor with move/rotate/scale gizmos, and a locally generated environment, so it works offline. |
| **Scripting** | **One language, TypeScript**, for server scripts and page scripts. The same API is used on both sides, and Monaco provides intellisense with **autocomplete of every tag path**. Server triggers: startup, interval, tag change (wildcards), cron, sunrise/sunset, alarm, manual. Scripts run in sandboxed `vm` contexts with persistent `state` and a live log console. |
| **Home automation** | Schedules (`cron`, `@every 30s`, `@sunset-15m`), notifications to ntfy, Telegram, Slack, Discord or a webhook, an MQTT publish API, and a REST device driver for Home Assistant. |
| **Map** | Leaflet GIS map with sites coloured by their worst active alarm, live value popups, links to displays and faceplates, and an in-app marker editor. |
| **Recipes** | Parameter sets: download to the process, capture live values as a new set, compare against live values. |
| **Security** | scrypt password hashes, HMAC-signed session tokens, roles (viewer < operator < engineer < admin), per-tag write roles, per-element minimum roles, and an **audit trail** of every write, acknowledgement, login and configuration change. |
| **Configuration** | `project.yaml` editor with validation, hot reload, **automatic revisions** with diff and restore, a file watcher (edit in Git or any editor), and a node editor UI. |
| **Ops** | Single process, no native modules (uses built-in `node:sqlite`), Docker image, health endpoint, structured logs, PWA manifest, dark and light themes. |

---

## Quick start

### Local (Node 24+)

```bash
npm install
npm run dev        # server :8080 (auto-restart) + Vite :5173 with hot reload → open http://localhost:5173
# or production:
npm run build && npm start      # → http://localhost:8080
npm test                        # server unit + protocol tests
npm run typecheck
```

### Docker

```bash
docker compose up -d                    # http://localhost:8080 — project + database persisted in the nexus-data volume
docker compose --profile iot up -d      # + Mosquitto MQTT broker for home IoT (use url mqtt://mosquitto:1883)
```

Environment variables: `PORT`, `NEXUS_PROJECT_DIR`, `NEXUS_DATA_DIR`, `NEXUS_SECRET` (token signing key), `LOG_LEVEL`, `NEXUS_BACKEND` (Vite dev proxy target).

---

## Project layout

```
shared/                 one source of truth for both sides
  types.ts              domain model (tags, alarms, displays, scenes, config)
  script-api.ts         THE script API (server + page) → also generates Monaco intellisense
  scriptCompiler.ts     TypeScript → JS compiler (sucrase), expressions, path & rule helpers
server/src/
  index.ts              HTTP server, static client, SignalR hub wiring
  Runtime.ts            composition root: creates and wires every service; serialised hot reload
  core/                 EventBus (observer), Database (node:sqlite + migrations), logger, errors
  config/               ProjectStore (YAML, revisions, file watch), DocumentRepository, validation
  tags/TagEngine.ts     real-time tag database, coercion, deadband, calculated tags
  drivers/              Driver strategy interface + factory registry + Simulation/Modbus/MQTT/REST/SQL
  alarms/               AlarmEngine (state machine), Notifier (ntfy/telegram/slack/discord/webhook)
  historian/            Historian (SQLite, aggregation, retention)
  scripting/            ScriptEngine (vm sandbox, triggers, queue) + ServerScriptApi (facade)
  automation/           Scheduler (cron, @every, solar), RecipeService
  security/             AuthService (scrypt, HMAC tokens, roles, audit)
  realtime/             SignalRServer (protocol adapter) + RuntimeHub (hub methods & broadcasts)
  api/routes.ts         REST API
client/src/
  lib/hub.ts            SignalR connection + ref-counted tag subscriptions + tag cache
  graphics/             element registry, symbols, controls, widgets, DisplayView, designer
  scene3d/              3D objects & SceneView
  scripting/            browser implementation of the shared script API, binding evaluator
  editor/               Monaco setup, generated typings
  pages/                Runtime, 3D, Alarms, Trends, Map, Tags, Devices, Recipes, Designer, Scripts, Config, System
project/                the running project (configuration as code)
  project.yaml          nodes, scripts, schedules, recipes, users, notifications, map
  displays/**.yaml      graphic pages & faceplate templates
  scenes/**.yaml        3D scenes
  scripts/*.ts          server scripts
```

### Design patterns used

- **Composition root / dependency injection.** `Runtime` builds all services once. No service creates another.
- **Observer.** A typed `EventBus` decouples the tag engine, alarms, historian, scripts and the hub.
- **Strategy + factory registry.** Drivers on the server and graphic elements on the client. Adding one means writing one module and one `register` call.
- **Repository.** `DocumentRepository<T>` for displays and scenes, and `ProjectStore` for YAML.
- **State machine.** Alarm lifecycle.
- **Facade.** The script API hides the services behind a small, stable, typed surface.
- **Adapter.** The SignalR protocol layer is separate from the hub logic.
- **Command (undo/redo).** Designer history uses checkpoints and transactional gestures.
- **Single source of truth.** Shared types and script API, plus one compiler for every script and expression.

---

## Scripting: one TypeScript API everywhere

Scripts are the body of an `async` function, so `await` and `return` work at top level.

```ts
// common (server + page)
tags.get(path) / tags.read(path) / await tags.write(path, v) / tags.writeMany({...}) / tags.toggle(path)
tags.on('Plant/Area1/*', (v, path) => ...)      // wildcard listeners
alarms.active(prefix) / alarms.ack(ids) / alarms.unackedCount(prefix)
await history.query([paths], from, to) / await history.average(path, seconds)
recipes.list() / await recipes.load('TankOperation', 'Normal')
log.info(...) · http.get/post(url) · await sleep(ms) · event (trigger info)

// server only
db.query(sql, ...params) / db.exec(...) · await mqtt.publish('Home/Zigbee', topic, payload)
await notify('message', { channel, severity }) · await runScript(name) · state (persistent)

// page only
ui.navigate(display) · ui.openFaceplate(path, display?) · ui.toast() · await ui.confirm() / ui.prompt()
display.vars · display.element('id')?.set('fill', 'red') · element (the clicked element)
```

Example server script (`project/scripts/Thermostat.ts`):

```ts
const temp: number = tags.get('Home/Sensors/LivingRoomTemp');
const target = tags.get('Home/Devices/AwayMode') ? tags.get('Home/Devices/ThermostatSetpoint') - 3 : tags.get('Home/Devices/ThermostatSetpoint');
if (temp < target - 0.4) await tags.write('Home/Devices/Heating', true);
else if (temp > target + 0.4) await tags.write('Home/Devices/Heating', false);
```

---

## YAML reference (excerpt)

```yaml
nodes:
  - kind: folder
    name: Home
    children:
      - kind: device
        name: Zigbee
        driver: mqtt                       # simulation | memory | modbus-tcp | mqtt | rest | sql
        settings: { url: 'mqtt://localhost:1883' }
        children:
          - kind: tag
            name: DeskLamp
            dataType: boolean
            writable: true
            source: { topic: zigbee2mqtt/desk_lamp, path: state, onValue: 'ON', offValue: 'OFF',
                      writeTopic: zigbee2mqtt/desk_lamp/set, writeTemplate: '{"state":"{{value}}"}' }
            history: { deadband: 0, interval: 60 }
            alarms: [{ kind: on, severity: low, delay: 600, message: 'Desk lamp on for 10 minutes' }]

scripts:
  - { name: MotionLight, file: MotionLight.ts, triggers: [{ type: tagChange, tags: [Home/Sensors/*] }, { type: interval, ms: 5000 }] }

schedules:
  - { name: EveningLights, cron: '@sunset-15m', actions: [{ write: Home/Devices/LivingRoomLight, value: true }] }

notifications:
  - { name: phone, type: ntfy, url: 'https://ntfy.sh/my-topic', minSeverity: high }
```

Modbus tag source: `{ area: holding|input|coil|discrete, address: 0, type: int16|uint16|int32|uint32|float32|bool, scale: 0.1, offset: 0, bit: 3 }`.
REST tag source: `{ path: /api/states/sensor.x, jsonPath: state, write | writeOn | writeOff: { method, path, body } }`.

---

## Security notes for production

- Replace demo passwords with `passwordHash` (`npm run hash-password -w server -- 'MyPassword'`).
- Set `NEXUS_SECRET`, and set `server.anonymousRole: null` to require login for viewing.
- Put the server behind TLS (reverse proxy) when exposed beyond the control network.
- Script sandboxing uses Node `vm` contexts. They isolate globals but are **not** a hard security boundary, so only grant the `engineer` role to trusted people.
