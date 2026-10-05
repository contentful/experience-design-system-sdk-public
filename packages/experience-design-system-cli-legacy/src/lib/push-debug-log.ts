import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliVersion } from '../analytics/client.js';

export const DEBUG_SESSION_DIR_ENV = 'EDS_DEBUG_SESSION_DIR';

export type PushDebugStatus = 'success' | 'error';

export interface PushDebugRun {
  finish(outputs: Record<string, unknown>, status: PushDebugStatus): void;
}

const NOOP_RUN: PushDebugRun = { finish: () => undefined };
const SECRET_VALUE = /CFPAT-[A-Za-z0-9_-]{20,}|^Bearer\s+\S+/;

function scrub(_key: string, value: unknown): unknown {
  if (/^cma_?token$/i.test(_key))
    return typeof value === 'string' && value ? `[present, ${value.length} chars]` : '[not set]';
  if (typeof value === 'string' && SECRET_VALUE.test(value)) return '[redacted]';
  return value;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function datePrefix(now: Date): string {
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`;
}

function nextFilename(dir: string, now: Date): string {
  const today = datePrefix(now);
  const pattern = new RegExp(`^${today}-push-attempt-(\\d+)\\.md$`);
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  const max = existing.reduce((acc, entry) => {
    const match = pattern.exec(entry);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `${today}-push-attempt-${max + 1}.md`;
}

function render(
  runId: string,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  status: PushDebugStatus,
  durationMs: number,
  now: Date,
): string {
  return `# Debug Log

- Run ID: ${runId}
- Flow: import
- Step: 01 - push
- Menu option: Push
- Date: ${now.toISOString()}
- CLI version: ${cliVersion()}
- Platform: ${process.platform} / Node ${process.version}
- Duration on screen: ${durationMs}ms
- Status: ${status}
- Exit method: completed

## Inputs
\`\`\`json
${JSON.stringify(inputs, scrub, 2)}
\`\`\`

## Outputs
\`\`\`json
${JSON.stringify(outputs, scrub, 2)}
\`\`\`
`;
}

/**
 * Records the inputs and outputs of the push step in the v2 debug session folder.
 * It does nothing unless the v2 CLI set EDS_DEBUG_SESSION_DIR, which it only does
 * when Debug Mode is on. Logging never throws.
 */
export function startPushDebugRun(inputs: Record<string, unknown>): PushDebugRun {
  const sessionDir = process.env[DEBUG_SESSION_DIR_ENV];
  if (!sessionDir) return NOOP_RUN;

  const startedAt = Date.now();
  let finished = false;

  return {
    finish(outputs, status) {
      if (finished) return;
      finished = true;
      try {
        const now = new Date();
        const dir = join(sessionDir, 'import');
        mkdirSync(dir, { recursive: true });
        const runId = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const content = render(runId, inputs, outputs, status, Date.now() - startedAt, now);
        writeFileSync(join(dir, nextFilename(dir, now)), content, { mode: 0o600 });
      } catch {
        // Debug logging must never break a push.
      }
    },
  };
}
