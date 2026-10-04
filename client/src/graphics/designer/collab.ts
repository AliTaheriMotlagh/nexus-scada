import { create } from 'zustand';
import { applyOps, diffDocs, type DesignOp, type Participant } from '@shared/designOps.ts';
import type { DisplayDoc } from '@shared/types.ts';
import { runtime } from '../../lib/hub.ts';
import { errorToast, toast } from '../../stores/ui.ts';
import { useDesigner } from './designerStore.ts';

interface JoinResult { doc: DisplayDoc; version: number; dirty: boolean; me: Participant; peers: Participant[] }

interface CollabState {
  /** Display currently joined */
  name: string | null;
  me: Participant | null;
  peers: Map<string, Participant>;
  /** display name → people editing it (whole project) */
  sessions: Record<string, { user: string; color: string }[]>;
}

export const useCollab = create<CollabState>(() => ({ name: null, me: null, peers: new Map(), sessions: {} }));

runtime.on('designSessions', (sessions: CollabState['sessions']) => useCollab.setState({ sessions }));

/** The element is selected (locked) by another editor → returns that participant. */
export function lockedBy(id: string): Participant | undefined {
  for (const p of useCollab.getState().peers.values()) if (p.selection.includes(id)) return p;
  return undefined;
}

interface Session {
  name: string;
  flush(): Promise<void>;
  cursor(p: { x: number; y: number } | null): void;
}
let current: Session | null = null;

export const setCursor = (p: { x: number; y: number } | null) => current?.cursor(p);

/** Save the shared document (everyone's changes) to disk. */
export async function saveDesign(): Promise<boolean> {
  if (!current) return false;
  await current.flush();
  try {
    await runtime.invoke('designSave', current.name);
    useDesigner.getState().markSaved();
    toast(`Saved ${current.name}`, 'success');
    return true;
  } catch (err) {
    errorToast(err);
    return false;
  }
}

export async function revertDesign(): Promise<void> {
  if (!current) return;
  try {
    await runtime.invoke('designRevert', current.name);
  } catch (err) {
    errorToast(err);
  }
}

/**
 * Join the collaborative session of a display. Local edits are diffed into element operations
 * (throttled to ~20/s) and sent to the server; collaborators' operations are applied as they arrive.
 */
export function startDesignSession(name: string, onLoaded?: (doc: DisplayDoc) => void): () => void {
  let synced: DisplayDoc | null = null;
  let applying = false;
  let disposed = false;
  let timer: number | undefined;
  let presenceTimer: number | undefined;
  let cursor: { x: number; y: number } | null = null;

  const load = (doc: DisplayDoc, dirty: boolean) => {
    applying = true;
    useDesigner.getState().load(name, doc);
    useDesigner.setState({ dirty });
    applying = false;
    synced = doc;
  };

  const join = async () => {
    try {
      const r = await runtime.invoke<JoinResult>('designJoin', name);
      if (disposed) return;
      load(r.doc, r.dirty);
      useCollab.setState({ name, me: r.me, peers: new Map(r.peers.map((p) => [p.connId, p])) });
      onLoaded?.(r.doc);
      sendPresence();
    } catch (err) {
      if (!disposed) errorToast(err);
    }
  };

  const flush = async () => {
    clearTimeout(timer);
    timer = undefined;
    const doc = useDesigner.getState().doc;
    if (!doc || !synced || useDesigner.getState().name !== name) return;
    const ops = diffDocs(synced, doc);
    if (!ops.length) return;
    synced = doc;
    try {
      const res = await runtime.invoke<{ version: number; rejected: string[] }>('designOps', name, ops);
      if (res.rejected.length) {
        toast('Someone else is editing that element — your change was reverted', 'warning');
        await join();
      }
    } catch (err) {
      errorToast(err);
    }
  };

  const sendPresence = () => {
    if (presenceTimer !== undefined) return;
    presenceTimer = window.setTimeout(() => {
      presenceTimer = undefined;
      void runtime.invoke('designPresence', name, cursor, useDesigner.getState().selection).catch(() => undefined);
    }, 50);
  };

  const unsubStore = useDesigner.subscribe((st, prev) => {
    if (st.name !== name) return;
    if (st.doc !== prev.doc && !applying && timer === undefined) timer = window.setTimeout(() => void flush(), 50);
    if (st.selection !== prev.selection) sendPresence();
  });

  const offs = [
    runtime.on('designOps', (n: string, ops: DesignOp[], _version: number, by: string) => {
      if (n !== name || by === runtime.connectionId || !synced) return;
      applying = true;
      useDesigner.getState().applyRemote(ops);
      useDesigner.setState({ dirty: true });
      applying = false;
      synced = applyOps(synced, ops);
    }),
    runtime.on('designPeer', (n: string, p: Participant) => {
      if (n !== name || p.connId === runtime.connectionId) return;
      const peers = new Map(useCollab.getState().peers);
      peers.set(p.connId, p);
      useCollab.setState({ peers });
    }),
    runtime.on('designLeave', (n: string, connId: string) => {
      if (n !== name) return;
      const peers = new Map(useCollab.getState().peers);
      peers.delete(connId);
      useCollab.setState({ peers });
    }),
    runtime.on('designSaved', (n: string, user: string) => {
      if (n !== name) return;
      useDesigner.getState().markSaved();
      if (user !== useCollab.getState().me?.user) toast(`${name} saved by ${user}`, 'info');
    }),
    runtime.on('designReset', (n: string, doc: DisplayDoc) => {
      if (n !== name) return;
      load(doc, false);
      toast('Unsaved changes were discarded', 'info');
    }),
    // rejoin after a reconnect (the server forgets connections that dropped)
    runtime.onState(() => { if (runtime.state === 'connected' && !disposed) void join(); }),
  ];

  current = {
    name,
    flush,
    cursor(p) {
      cursor = p;
      sendPresence();
    },
  };

  if (runtime.state === 'connected') void join();
  void runtime.invoke<CollabState['sessions']>('designSessions').then((sessions) => useCollab.setState({ sessions })).catch(() => undefined);

  return () => {
    disposed = true;
    void flush().finally(() => void runtime.invoke('designLeave', name).catch(() => undefined));
    unsubStore();
    offs.forEach((o) => o());
    clearTimeout(presenceTimer);
    if (current?.name === name) current = null;
    useCollab.setState({ name: null, me: null, peers: new Map() });
  };
}
