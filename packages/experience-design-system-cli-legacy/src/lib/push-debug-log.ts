import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { cliVersion } from '../analytics/client.js';

export const DEBUG_SESSION_DIR_ENV = 'EDS_DEBUG_SESSION_DIR';

export type PushOutcome =
  | 'in-progress'
  | 'pushed'
  | 'partial'
  | 'failed'
  | 'preview-failed'
  | 'nothing-to-push'
  | 'skipped'
  | 'superseded';

export interface PushDebugResult {
  outcome: PushOutcome;
  /** One plain-English sentence that says what happened and why. */
  summary: string;
  details?: Record<string, unknown>;
}

export interface PushDebugEventOptions {
  note?: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

export interface PushDebugRun {
  event(title: string, options?: PushDebugEventOptions): void;
  finish(result: PushDebugResult): void;
}

const NOOP_RUN: PushDebugRun = { event: () => undefined, finish: () => undefined };

const OUTCOME_LABEL: Record<PushOutcome, string> = {
  'in-progress': '⏳ In progress (the process ended before the push finished)',
  pushed: '✅ Pushed',
  partial: '⚠️ Partly pushed (some items failed)',
  failed: '❌ Push failed',
  'preview-failed': '❌ Preview failed (nothing was sent to apply)',
  'nothing-to-push': 'ℹ️ Nothing to push (the server says the space already matches)',
  skipped: '⏭️ Skipped',
  superseded: '↩️ Superseded by a newer attempt',
};

const MAX_BLOCK_CHARS = 100_000;
const SECRET_VALUE = /CFPAT-[A-Za-z0-9_-]{20,}|^Bearer\s+\S+/;

function scrub(key: string, value: unknown): unknown {
  if (/^cma_?token$/i.test(key)) {
    return typeof value === 'string' && value ? `[present, ${value.length} chars]` : '[not set]';
  }
  if (typeof value === 'string' && SECRET_VALUE.test(value)) return '[redacted]';
  return value;
}

function json(value: unknown): string {
  const text = JSON.stringify(value, scrub, 2) ?? 'null';
  return text.length > MAX_BLOCK_CHARS
    ? `${text.slice(0, MAX_BLOCK_CHARS)}\n… truncated, ${text.length - MAX_BLOCK_CHARS} more characters`
    : text;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function datePrefix(now: Date): string {
  return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}`;
}

function clock(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
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

interface RecordedEvent {
  at: Date;
  sinceStartMs: number;
  title: string;
  note?: string;
  data?: Record<string, unknown>;
  requestId?: string;
}

function entityName(entry: unknown): string {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const record = entry as Record<string, unknown>;
    for (const field of ['key', 'name', '$name', 'id']) {
      if (typeof record[field] === 'string') return record[field] as string;
    }
    const current = record['current'];
    if (current && typeof current === 'object' && typeof (current as Record<string, unknown>)['name'] === 'string') {
      return (current as Record<string, unknown>)['name'] as string;
    }
  }
  return 'unknown';
}

function group(diff: {
  new: unknown[];
  changed: unknown[];
  unchanged: string[];
  removed: unknown[];
}): Record<string, unknown> {
  return {
    new: diff.new.map(entityName),
    changed: diff.changed.map((entry) => {
      const breaking =
        entry &&
        typeof entry === 'object' &&
        (entry as { changeClassification?: { classification?: string } }).changeClassification?.classification ===
          'breaking';
      return breaking ? `${entityName(entry)} (breaking)` : entityName(entry);
    }),
    unchanged: diff.unchanged,
    removed: diff.removed.map(entityName),
  };
}

/** The server's preview, reduced to the names in each group so it is easy to read. */
export function summarizePreview(preview: ServerPreviewResponse): Record<string, unknown> {
  return { components: group(preview.components), tokens: group(preview.tokens) };
}

/** The entries of a CDF that will be sent: name, type and the properties and slots each has. */
export function summarizeCdf(cdf: Record<string, unknown>): Array<Record<string, unknown>> {
  return Object.entries(cdf)
    .filter(([key]) => !key.startsWith('$') && key !== 'allowDeletions')
    .map(([key, value]) => {
      const entry = (value ?? {}) as Record<string, unknown>;
      const properties = entry['$properties'];
      const slots = entry['$slots'];
      return {
        name: key,
        type: entry['$type'],
        properties:
          properties && typeof properties === 'object' ? Object.keys(properties as Record<string, unknown>) : [],
        slots: slots && typeof slots === 'object' ? Object.keys(slots as Record<string, unknown>) : [],
      };
    });
}

function renderEvents(events: RecordedEvent[]): string {
  if (events.length === 0) return '_Nothing recorded yet._';
  return events
    .map((event, index) => {
      const note = event.note ? ` — ${event.note}` : '';
      const request = event.requestId ? ` _(request ${event.requestId})_` : '';
      return `${index + 1}. \`${clock(event.at)}\` (+${event.sinceStartMs}ms) **${event.title}**${note}${request}`;
    })
    .join('\n');
}

function renderDetails(events: RecordedEvent[]): string {
  const withData = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.data && Object.keys(event.data).length > 0);
  if (withData.length === 0) return '';
  return withData
    .map(
      ({ event, index }) =>
        `<details>\n<summary>${index + 1}. ${event.title}</summary>\n\n\`\`\`json\n${json(event.data)}\n\`\`\`\n\n</details>`,
    )
    .join('\n\n');
}

function render(
  runId: string,
  inputs: Record<string, unknown>,
  events: RecordedEvent[],
  startedAt: Date,
  result: PushDebugResult,
  durationMs: number,
): string {
  const requestIds = [...new Set(events.map((event) => event.requestId).filter(Boolean))];
  const text = (field: string): string => String(inputs[field] ?? '—');
  const details = renderDetails(events);

  return `# Push to Contentful — debug log

## Summary

| | |
|---|---|
| **Result** | ${OUTCOME_LABEL[result.outcome]} |
| **What happened** | ${result.summary} |
| **Space / environment** | \`${text('space_id')}\` / \`${text('environment_id')}\` |
| **Host** | ${text('host')} |
| **Started** | ${startedAt.toISOString()} |
| **Duration** | ${durationMs}ms |
| **Request IDs** | ${requestIds.length > 0 ? requestIds.map((id) => `\`${id}\``).join(', ') : '—'} |
| **CLI / runtime** | ${cliVersion()} · ${process.platform} · Node ${process.version} |
| **Run ID** | ${runId} |

## Timeline

${renderEvents(events)}

## Inputs

\`\`\`json
${json(inputs)}
\`\`\`

## Result

\`\`\`json
${json({ outcome: result.outcome, summary: result.summary, ...(result.details ?? {}) })}
\`\`\`
${details ? `\n## Details\n\n${details}\n` : ''}`;
}

/**
 * Records the push step (preview, confirmation and apply) in the v2 debug session folder.
 * The file is rewritten after every event, so a push that dies partway still leaves a log.
 * It does nothing unless the v2 CLI set EDS_DEBUG_SESSION_DIR, which it only does when
 * Debug Mode is on. Logging never throws.
 */
export function startPushDebugRun(inputs: Record<string, unknown>): PushDebugRun {
  const sessionDir = process.env[DEBUG_SESSION_DIR_ENV];
  if (!sessionDir) return NOOP_RUN;

  const startedAt = new Date();
  const runId = `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;
  const events: RecordedEvent[] = [];
  let result: PushDebugResult = {
    outcome: 'in-progress',
    summary: 'The push started but no final result was recorded.',
  };
  let finished = false;
  let path: string | undefined;

  const flush = (): void => {
    try {
      if (!path) {
        const dir = join(sessionDir, 'import');
        mkdirSync(dir, { recursive: true });
        path = join(dir, nextFilename(dir, startedAt));
      }
      writeFileSync(path, render(runId, inputs, events, startedAt, result, Date.now() - startedAt.getTime()), {
        mode: 0o600,
      });
    } catch {
      // Debug logging must never break a push.
    }
  };

  flush();

  return {
    event(title, options = {}) {
      if (finished) return;
      const at = new Date();
      events.push({ at, sinceStartMs: at.getTime() - startedAt.getTime(), title, ...options });
      flush();
    },
    finish(final) {
      if (finished) return;
      finished = true;
      result = final;
      const at = new Date();
      events.push({
        at,
        sinceStartMs: at.getTime() - startedAt.getTime(),
        title: OUTCOME_LABEL[final.outcome].replace(/^\S+\s/, ''),
        note: final.summary,
      });
      flush();
    },
  };
}
