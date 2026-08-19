import { generateSessionId } from '../session/session-id.js';
import { ANALYTICS_SESSION_ENV } from './constants.js';

/** Prefer the pipeline parent session, then an explicit id, then a new slug. */
export function resolveAnalyticsSessionId(explicit?: string): string {
  const inherited = process.env[ANALYTICS_SESSION_ENV]?.trim();
  if (inherited) return inherited;
  const passed = explicit?.trim();
  if (passed) return passed;
  return generateSessionId();
}

export function isPipelineAnalyticsChild(): boolean {
  return Boolean(process.env[ANALYTICS_SESSION_ENV]?.trim());
}
