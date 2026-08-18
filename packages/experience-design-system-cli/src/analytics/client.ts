import { createRequire } from 'node:module';
import { Analytics } from '@segment/analytics-node';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Anonymous usage telemetry for the CLI. Disabled when DISABLE_ANALYTICS is set
// or when no write key is configured. Never blocks command execution.

let analyticsClient: Analytics | null = null;

export function cliVersion(): string {
  return pkg.version;
}

export function analyticsEnabled(): boolean {
  return !process.env.DISABLE_ANALYTICS && Boolean(resolveWriteKey());
}

function resolveWriteKey(): string | undefined {
  const key = (process.env.SEGMENT_WRITE_KEY ?? '').trim();
  return key.length > 0 ? key : undefined;
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
}
