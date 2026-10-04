import { Socket } from 'node:net';
import { Backoff, errorMessage } from '../core/util.ts';
import type { TagRuntime } from '../tags/TagEngine.ts';
import { bool, num, src, str, type Driver, type DriverContext } from './Driver.ts';

type Area = 'holding' | 'input' | 'coil' | 'discrete';
type MbType = 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'bool';

interface Address {
  area: Area;
  address: number;
  type: MbType;
  bit?: number;
  scale: number;
  offset: number;
}

const READ_FC: Record<Area, number> = { coil: 1, discrete: 2, holding: 3, input: 4 };
const isBitArea = (a: Area) => a === 'coil' || a === 'discrete';
const regCount = (t: MbType) => (t === 'int32' || t === 'uint32' || t === 'float32' ? 2 : 1);

function parseAddress(tag: TagRuntime): Address {
  const s = src(tag);
  const area = str(s.area, 'holding') as Area;
  if (!(area in READ_FC)) throw new Error(`${tag.path}: unknown modbus area "${area}"`);
  return {
    area,
    address: num(s.address, 0),
    type: (str(s.type, isBitArea(area) ? 'bool' : 'int16') as MbType),
    bit: s.bit === undefined ? undefined : num(s.bit, 0),
    scale: num(s.scale, 1),
    offset: num(s.offset, 0),
  };
}

/** Minimal, dependency-free Modbus TCP master with one outstanding request at a time. */
class ModbusClient {
  private socket?: Socket;
  private buffer = Buffer.alloc(0);
  private tid = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private pending?: { tid: number; resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
  private readonly timeoutMs: number;
  onClose?: (err?: Error) => void;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('connect timeout')); }, this.timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (err) => { clearTimeout(timer); reject(err); });
      socket.on('data', (d) => this.onData(d));
      socket.on('close', () => {
        this.pending?.reject(new Error('connection closed'));
        this.pending = undefined;
        this.onClose?.();
      });
      socket.setNoDelay(true);
      socket.connect(port, host);
      this.socket = socket;
    });
  }

  close(): void {
    this.onClose = undefined;
    this.socket?.destroy();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 7) {
      const total = 6 + this.buffer.readUInt16BE(4);
      if (this.buffer.length < total) break;
      const frame = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      const p = this.pending;
      if (!p || frame.readUInt16BE(0) !== p.tid) continue;
      clearTimeout(p.timer);
      this.pending = undefined;
      const fc = frame[7];
      if (fc & 0x80) p.reject(new Error(`modbus exception ${frame[8]}`));
      else p.resolve(frame.subarray(8));
    }
  }

  /** Send a PDU and resolve with the response data (after the function code). */
  request(unit: number, fc: number, data: Buffer): Promise<Buffer> {
    const run = () => new Promise<Buffer>((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) return reject(new Error('not connected'));
      this.tid = (this.tid + 1) & 0xffff;
      const header = Buffer.alloc(8);
      header.writeUInt16BE(this.tid, 0);
      header.writeUInt16BE(0, 2);
      header.writeUInt16BE(data.length + 2, 4);
      header.writeUInt8(unit, 6);
      header.writeUInt8(fc, 7);
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error('response timeout'));
      }, this.timeoutMs);
      this.pending = { tid: this.tid, resolve, reject, timer };
      this.socket.write(Buffer.concat([header, data]));
    });
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  async read(unit: number, area: Area, start: number, count: number): Promise<Buffer> {
    const req = Buffer.alloc(4);
    req.writeUInt16BE(start, 0);
    req.writeUInt16BE(count, 2);
    const res = await this.request(unit, READ_FC[area], req);
    return res.subarray(1, 1 + res[0]);
  }

  async writeRegisters(unit: number, start: number, regs: Buffer): Promise<void> {
    if (regs.length === 2) {
      const req = Buffer.alloc(4);
      req.writeUInt16BE(start, 0);
      regs.copy(req, 2);
      await this.request(unit, 6, req);
      return;
    }
    const req = Buffer.alloc(5 + regs.length);
    req.writeUInt16BE(start, 0);
    req.writeUInt16BE(regs.length / 2, 2);
    req.writeUInt8(regs.length, 4);
    regs.copy(req, 5);
    await this.request(unit, 16, req);
  }

  async writeCoil(unit: number, address: number, on: boolean): Promise<void> {
    const req = Buffer.alloc(4);
    req.writeUInt16BE(address, 0);
    req.writeUInt16BE(on ? 0xff00 : 0x0000, 2);
    await this.request(unit, 5, req);
  }
}

interface Block { area: Area; start: number; count: number; tags: { tag: TagRuntime; addr: Address }[] }

/** Group tags into contiguous read blocks to minimise round trips. */
function buildBlocks(tags: TagRuntime[], log: DriverContext['log']): Block[] {
  const byArea = new Map<Area, { tag: TagRuntime; addr: Address }[]>();
  for (const tag of tags) {
    try {
      const addr = parseAddress(tag);
      if (!byArea.has(addr.area)) byArea.set(addr.area, []);
      byArea.get(addr.area)!.push({ tag, addr });
    } catch (err) {
      log.warn(errorMessage(err));
    }
  }
  const blocks: Block[] = [];
  for (const [area, items] of byArea) {
    items.sort((a, b) => a.addr.address - b.addr.address);
    const maxLen = isBitArea(area) ? 2000 : 120;
    let cur: Block | undefined;
    for (const item of items) {
      const end = item.addr.address + (isBitArea(area) ? 1 : regCount(item.addr.type));
      if (cur && end - cur.start <= maxLen && item.addr.address - (cur.start + cur.count) <= 16) {
        cur.count = Math.max(cur.count, end - cur.start);
        cur.tags.push(item);
      } else {
        cur = { area, start: item.addr.address, count: end - item.addr.address, tags: [item] };
        blocks.push(cur);
      }
    }
  }
  return blocks;
}

function decode(data: Buffer, block: Block, addr: Address, wordSwap: boolean): unknown {
  const rel = addr.address - block.start;
  if (isBitArea(block.area)) return ((data[rel >> 3] >> (rel & 7)) & 1) === 1;
  let raw: number;
  const off = rel * 2;
  if (regCount(addr.type) === 2) {
    const b = Buffer.from(data.subarray(off, off + 4));
    if (wordSwap) b.swap32().swap16();
    raw = addr.type === 'float32' ? b.readFloatBE(0) : addr.type === 'int32' ? b.readInt32BE(0) : b.readUInt32BE(0);
  } else if (addr.type === 'bool') {
    return ((data.readUInt16BE(off) >> (addr.bit ?? 0)) & 1) === 1;
  } else {
    raw = addr.type === 'int16' ? data.readInt16BE(off) : data.readUInt16BE(off);
  }
  return raw * addr.scale + addr.offset;
}

function encode(value: number, addr: Address, wordSwap: boolean): Buffer {
  const raw = (value - addr.offset) / addr.scale;
  const b = Buffer.alloc(regCount(addr.type) * 2);
  switch (addr.type) {
    case 'int16': b.writeInt16BE(Math.round(raw)); break;
    case 'uint16': b.writeUInt16BE(Math.round(raw)); break;
    case 'int32': b.writeInt32BE(Math.round(raw)); break;
    case 'uint32': b.writeUInt32BE(Math.round(raw)); break;
    case 'float32': b.writeFloatBE(raw); break;
    default: throw new Error(`cannot write type ${addr.type}`);
  }
  if (wordSwap && b.length === 4) b.swap32().swap16();
  return b;
}

/**
 * Modbus TCP device.
 * settings: { host, port=502, unitId=1, pollMs=1000, timeoutMs=2000, wordSwap=false }
 * tag source: { area: holding|input|coil|discrete, address, type: int16|uint16|int32|uint32|float32|bool, bit, scale, offset }
 */
export function createModbusTcpDriver(ctx: DriverContext): Driver {
  const host = str(ctx.settings.host, '127.0.0.1');
  const port = num(ctx.settings.port, 502);
  const unit = num(ctx.settings.unitId, 1);
  const pollMs = num(ctx.settings.pollMs, 1000);
  const wordSwap = bool(ctx.settings.wordSwap);
  const blocks = buildBlocks(ctx.device.tags, ctx.log);
  const backoff = new Backoff(1000, 30000);
  let client: ModbusClient | undefined;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const poll = async () => {
    if (!client || stopped) return;
    for (const block of blocks) {
      try {
        const data = await client.read(unit, block.area, block.start, block.count);
        for (const { tag, addr } of block.tags) ctx.update(tag.path, decode(data, block, addr, wordSwap));
        ctx.countRead(block.tags.length);
      } catch (err) {
        ctx.countError();
        for (const { tag } of block.tags) ctx.update(tag.path, tag.current.value, 'bad');
        ctx.log.warn(`read ${block.area}@${block.start} failed: ${errorMessage(err)}`);
        if (errorMessage(err).includes('not connected') || errorMessage(err).includes('closed')) return;
      }
    }
    timer = setTimeout(poll, pollMs);
  };

  const connect = async () => {
    if (stopped) return;
    ctx.status('connecting', `${host}:${port}`);
    client = new ModbusClient(num(ctx.settings.timeoutMs, 2000));
    try {
      await client.connect(host, port);
      backoff.reset();
      ctx.status('connected', `${host}:${port} unit ${unit}`);
      client.onClose = () => {
        clearTimeout(timer);
        ctx.setQuality('bad');
        ctx.status('error', 'connection lost');
        scheduleReconnect();
      };
      void poll();
    } catch (err) {
      ctx.setQuality('bad');
      ctx.status('error', errorMessage(err));
      ctx.countError();
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    timer = setTimeout(connect, backoff.next());
  };

  return {
    start: () => { void connect(); },
    stop() {
      stopped = true;
      clearTimeout(timer);
      client?.close();
    },
    async write(tag, value) {
      if (!client) throw new Error('device not connected');
      const addr = parseAddress(tag);
      if (addr.area === 'coil') await client.writeCoil(unit, addr.address, Boolean(value));
      else if (addr.area === 'holding') await client.writeRegisters(unit, addr.address, encode(Number(value), addr, wordSwap));
      else throw new Error(`${addr.area} registers are read-only`);
      ctx.countWrite();
      ctx.update(tag.path, value);
    },
  };
}
