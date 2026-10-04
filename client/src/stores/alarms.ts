import { create } from 'zustand';
import type { AlarmEvent, AlarmInfo } from '@shared/types.ts';

interface AlarmState {
  list: AlarmInfo[];
  hornSilenced: boolean;
  hornEnabled: boolean;
  set(list: AlarmInfo[]): void;
  onEvent(ev: AlarmEvent): void;
  silence(): void;
  setHornEnabled(on: boolean): void;
}

export const useAlarms = create<AlarmState>((set) => ({
  list: [],
  hornSilenced: false,
  hornEnabled: true,
  set: (list) => set({ list }),
  onEvent(ev) {
    if (ev.event === 'active' && (ev.severity === 'critical' || ev.severity === 'high')) set({ hornSilenced: false });
  },
  silence: () => set({ hornSilenced: true }),
  setHornEnabled: (on) => set({ hornEnabled: on }),
}));

// ── Audible horn: beeps while unacknowledged high/critical alarms exist and it is not silenced ──
let audio: AudioContext | undefined;
function beep(freq: number) {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.04, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.35);
  } catch { /* audio not available */ }
}

setInterval(() => {
  const { list, hornSilenced, hornEnabled } = useAlarms.getState();
  if (hornSilenced || !hornEnabled) return;
  const urgent = list.find((a) => a.state === 'active-unacked' && !a.shelvedUntil && (a.severity === 'critical' || a.severity === 'high'));
  if (urgent) beep(urgent.severity === 'critical' ? 880 : 660);
}, 1600);
