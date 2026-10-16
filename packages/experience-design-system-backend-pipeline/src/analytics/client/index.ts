// Public facade for the analytics client — preserves the shape callers (and tests) expect while
// the implementation is split across cli-info, opt-out, and segment-client.
import { resetCliVersionForTests } from './cli-info.js';
import { resetOptOutForTests } from './opt-out.js';
import { resetSegmentClientForTests } from './segment-client.js';

export { setCliVersion, cliVersion } from './cli-info.js';
export { setPersistedAnalyticsDisabled, analyticsEnabled } from './opt-out.js';
export { trackEvent, flushAnalytics } from './segment-client.js';

/** Clears every piece of module-level state the analytics client owns. */
export function resetAnalyticsClientForTests(): void {
  resetSegmentClientForTests();
  resetOptOutForTests();
  resetCliVersionForTests();
}
