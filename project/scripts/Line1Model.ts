// Packaging line model: counts, random faults (auto-cleared after 12 s) and OEE time base
const B = 'Sites/Line1';
const stations = ['Infeed', 'Filler', 'Capper', 'Labeler', 'Packer'];
let st: string = tags.get(B + '/State');
const running: boolean = tags.get(B + '/Running');
if (st === 'Fault' && Date.now() - (state.faultAt ?? 0) > 12000) { st = 'Running'; await tags.write(B + '/FaultStation', ''); }
if (!running) st = 'Stopped';
else if (st === 'Stopped') st = 'Running';
if (st === 'Running' && Math.random() < 0.01) {
  st = 'Fault';
  state.faultAt = Date.now();
  const where = stations[Math.floor(Math.random() * stations.length)];
  await tags.write(B + '/FaultStation', where);
  log.warn('Fault at ' + where);
}
const updates: Record<string, unknown> = { [B + '/State']: st, [B + '/TotalSeconds']: tags.get(B + '/TotalSeconds') + 1 };
if (st === 'Running') {
  const made = tags.get(B + '/Speed') / 60;
  const rejects = Math.random() < 0.04 ? 1 : 0;
  updates[B + '/Good'] = Math.round((tags.get(B + '/Good') + made - rejects) * 10) / 10;
  updates[B + '/Rejects'] = tags.get(B + '/Rejects') + rejects;
  updates[B + '/RunSeconds'] = tags.get(B + '/RunSeconds') + 1;
}
await tags.writeMany(updates);
