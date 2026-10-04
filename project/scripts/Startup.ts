// Runs once when the runtime starts (trigger: startup).
// `state` is persisted in the database between runs and restarts.
state.starts = (state.starts ?? 0) + 1;
log.info(`Nexus runtime online — start #${state.starts}`);

await tags.write('System/Message', `Runtime started ${new Date().toLocaleString()}`);
