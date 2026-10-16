// Public facade for the tracker — preserves the shape callers (and tests) expect while the
// implementation is split across pending-command (state + mutations) and emit-events (Segment calls).
export {
  enrichCommandResult,
  noteCommandStart,
  resetAnalyticsStateForTests,
  setCommandContext,
} from './pending-command.js';
export {
  bindAnalyticsSession,
  bindAnalyticsSessionId,
  completeActiveCommand,
  emitSessionStarted,
  failActiveCommand,
} from './emit-events.js';
