// Hallway light follows motion with an off-delay.
// Triggers: tag change of HallwayMotion, and every 5 s to check the timeout.
const LIGHT = 'Home/Devices/HallwayLight';
const OFF_DELAY_MS = 60_000;

if (event.type === 'tagChange' && event.value === true) {
  state.lastMotion = Date.now();
  if (!tags.get(LIGHT) && !tags.get('Home/Devices/AwayMode')) {
    await tags.write(LIGHT, true);
    log.info('Motion in hallway → light on');
  }
  return;
}

if (event.type === 'interval' && tags.get(LIGHT) && Date.now() - (state.lastMotion ?? 0) > OFF_DELAY_MS) {
  await tags.write(LIGHT, false);
  log.info('No motion for 60 s → hallway light off');
}
