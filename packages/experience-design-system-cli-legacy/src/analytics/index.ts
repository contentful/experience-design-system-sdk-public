// Business layer re-exported from backend-pipeline (same session state, same Segment client).
// `exitWithAnalytics` + `failureFromApiError` stay here because they call `process.exit`.
export {
  bindAnalyticsSessionId,
  completeActiveCommand,
  emitSessionStarted,
  enrichCommandResult,
  failActiveCommand,
  flushAnalytics,
  isPipelineAnalyticsChild,
  noteCommandStart,
  recordApplyOutcome,
  recordContentfulContext,
  setCliVersion,
  setPersistedAnalyticsDisabled,
} from '@contentful/experience-design-system-backend-pipeline';
export type { CommandFailure } from '@contentful/experience-design-system-backend-pipeline';
export { exitWithAnalytics, failureFromApiError } from './exit.js';
