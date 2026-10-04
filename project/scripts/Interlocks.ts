// Safety interlocks (trigger: any change under Plant/Area1).
interface Interlock { when: () => boolean; action: () => Promise<void>; text: string }

const tanks = ['Tank1', 'Tank2'].map((t) => `Plant/Area1/${t}`);

const interlocks: Interlock[] = [
  ...tanks.map((t) => ({
    text: `${t}: dry-run protection — pump stopped`,
    when: () => tags.get(`${t}/Pump/Running`) && tags.get(`${t}/Level`) < 3,
    action: () => tags.write(`${t}/Pump/Running`, false),
  })),
  ...tanks.map((t) => ({
    text: `${t}: overflow protection — inlet closed`,
    when: () => tags.get(`${t}/InletValve`) && tags.get(`${t}/Level`) > 98,
    action: () => tags.write(`${t}/InletValve`, false),
  })),
  {
    text: 'Emergency stop — all pumps and valves off',
    when: () => tags.get('Plant/Area1/EmergencyStop') && tanks.some((t) => tags.get(`${t}/Pump/Running`) || tags.get(`${t}/InletValve`)),
    action: async () => {
      for (const t of tanks) await tags.writeMany({ [`${t}/Pump/Running`]: false, [`${t}/InletValve`]: false });
      await tags.write('Plant/Area1/BlowerRunning', false);
    },
  },
];

for (const il of interlocks) {
  if (il.when()) {
    log.warn(il.text);
    await il.action();
  }
}
