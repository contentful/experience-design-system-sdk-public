import { createRequire } from 'node:module';
import { Analytics } from '@segment/analytics-node';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Anonymous usage telemetry for the CLI. Disabled when DISABLE_ANALYTICS is set
// or when the setup preference opts out. Never blocks command execution.

// Public write key scoped to data source. Grants write-only event ingest; a
// distributed CLI cannot hold a secret, so this ships in source by design.
const DEFAULT_WRITE_KEY = '6DmxiEPN3SV1vbRTTMcNqDzCvkfwT06N';

let analyticsClient: Analytics | null = null;
let persistedDisabled = false;

export function cliVersion(): string {
  return pkg.version;
}

// Set once per invocation from the persisted `experiences setup` preference
// (credentials.json `analyticsDisabled`). Sticky-off: once set, DISABLE_ANALYTICS
// has nothing left to override — see setPersistedAnalyticsDisabled callers.
export function setPersistedAnalyticsDisabled(disabled: boolean): void {
  persistedDisabled = disabled;
}

export function analyticsEnabled(): boolean {
  return !persistedDisabled && !process.env.DISABLE_ANALYTICS && Boolean(resolveWriteKey());
}

// SEGMENT_WRITE_KEY overrides the default so engineers can point a local run at
// their own staging connection.
function resolveWriteKey(): string {
  const key = (process.env.SEGMENT_WRITE_KEY ?? '').trim();
  return key.length > 0 ? key : DEFAULT_WRITE_KEY;
}

function getClient(): Analytics | null {
  if (!analyticsEnabled()) return null;
  const writeKey = resolveWriteKey();
  if (!writeKey) return null;
  if (!analyticsClient) {
    analyticsClient = new Analytics({ writeKey });
    analyticsClient.on('error', () => {
      /* never block the CLI on telemetry errors */
    });
  }
  return analyticsClient;
}

export async function trackEvent(
  event: string,
  properties: Record<string, unknown>,
  anonymousId: string,
  options?: { flush?: boolean },
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    client.track({
      event,
      properties,
      anonymousId,
      timestamp: new Date(),
    });
    if (options?.flush) await flushAnalytics();
  } catch {
    // Telemetry must never affect CLI exit codes or output.
  }
}

// CLI processes are short-lived — we flush (and recreate the client) after each
// event so terminal telemetry survives process.exit. Do not "optimize" this into
// a deferred batch flush on process exit; Node will not await async exit hooks.
export async function flushAnalytics(): Promise<void> {
  if (!analyticsClient) return;
  try {
    await analyticsClient.closeAndFlush();
  } catch {
    // Swallow — telemetry must never affect CLI behavior.
  } finally {
    analyticsClient = null;
  }
}

export function resetAnalyticsClientForTests(): void {
  analyticsClient = null;
  persistedDisabled = false;
}
