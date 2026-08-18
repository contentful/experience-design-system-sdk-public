import { createRequire } from 'node:module';
import { Analytics } from '@segment/analytics-node';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// Anonymous usage telemetry for the CLI. Disabled when DISABLE_ANALYTICS is set
// or when no write key is configured. Never blocks command execution.

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

export async function trackEvent(
  event: string,
  properties: Record<string, unknown>,
  anonymousId: string,
): Promise<void> {
  if (!analyticsEnabled()) return;

  const writeKey = resolveWriteKey();
  if (!writeKey) return;

  try {
    const client = new Analytics({ writeKey });
    client.on('error', () => {
      /* never block the CLI on telemetry errors */
    });
    client.track({
      event,
      properties,
      anonymousId,
      timestamp: new Date(),
    });
    await client.closeAndFlush();
  } catch {
    // Telemetry must never affect CLI exit codes or output.
  }
}
