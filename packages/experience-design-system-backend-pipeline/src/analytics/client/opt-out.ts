let persistedDisabled = false;

// Set once per invocation from the persisted `experiences setup` preference
// (credentials.json `analyticsDisabled`). Sticky-off: once set, DISABLE_ANALYTICS
// has nothing left to override — see setPersistedAnalyticsDisabled callers.
export function setPersistedAnalyticsDisabled(disabled: boolean): void {
  persistedDisabled = disabled;
}

export function analyticsEnabled(): boolean {
  return !persistedDisabled && !process.env['DISABLE_ANALYTICS'];
}

export function resetOptOutForTests(): void {
  persistedDisabled = false;
}
