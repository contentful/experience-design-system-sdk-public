export { ANALYTICS_SESSION_ENV, IMPORT_PIPELINE_ENV } from './constants.js';
export { analyticsEnvForSubprocess, pipelineSubprocessEnv } from './env.js';
export { exitWithAnalytics, failureFromApiError, failureFromUnknown } from './exit.js';
export {
  analyticsEnabled,
  cliVersion,
  flushAnalytics,
  resetAnalyticsClientForTests,
  setPersistedAnalyticsDisabled,
  trackEvent,
} from './client.js';
export { isPipelineAnalyticsChild, resolveAnalyticsSessionId } from './session.js';
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
