export { analyticsEnabled, cliVersion, trackEvent } from './client.js';
export { normalizeCommand } from './normalize.js';
export { getOsName } from './os.js';
export {
  bindAnalyticsSession,
  bindAnalyticsSessionId,
  completeActiveCommand,
  emitSessionStarted,
  enrichCommandResult,
  failActiveCommand,
  getBoundSessionId,
  noteCommandStart,
  registerAnalyticsExitHook,
  resetAnalyticsStateForTests,
  setCommandContext,
} from './tracker.js';
export { recordApplyOutcome, recordContentfulContext } from './apply.js';
export type {
  CommandCompletion,
  CommandContext,
  CommandFailure,
  DsiCliCommand,
  EntryCommand,
  OsName,
  WriteResult,
} from './types.js';
