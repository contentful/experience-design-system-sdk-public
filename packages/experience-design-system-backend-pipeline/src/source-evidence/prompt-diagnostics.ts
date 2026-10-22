import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PreparedStagePrompt } from '../agents/helpers/run-stage-with-retries.js';
import { isExtractionDiagnosticsPayload } from '../persistence/src/session/repositories/source-evidence-validation.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function counts(values: readonly string[]): Array<{ value: string; count: number }> {
  const totals = new Map<string, number>();
  for (const value of values) totals.set(value, (totals.get(value) ?? 0) + 1);
  return [...totals].sort(([left], [right]) => left.localeCompare(right)).map(([value, count]) => ({ value, count }));
}

/** Unknown diagnostics stay inline; routine receipts remain available in the full audit. */
export function summarizePromptDiagnostics(diagnostics: readonly unknown[]): unknown[] {
  const exclusions = diagnostics.filter(
    (item): item is Record<string, unknown> & { reason: string } =>
      record(item) && item.kind === 'excluded' && typeof item.reason === 'string',
  );
  let exclusionsEmitted = false;
  return diagnostics.flatMap((item): unknown[] => {
    if (!record(item)) return [item];
    if (item.kind === 'excluded' && typeof item.reason === 'string') {
      if (exclusionsEmitted) return [];
      exclusionsEmitted = true;
      return [
        {
          kind: 'excluded-summary',
          count: exclusions.length,
          reasons: counts(exclusions.map((entry) => entry.reason.split(':')[0]!)),
          details: 'Full excluded paths and receipts are in the supplied diagnostic audit.',
        },
      ];
    }
    if (item.kind !== 'compiler-run' || !record(item.diagnostics)) return [item];
    const wrapper = item.diagnostics;
    const payload = wrapper.diagnostics ?? wrapper;
    if (!isExtractionDiagnosticsPayload(payload) || !payload.reads?.length) return [item];
    const { reads, ...rest } = payload;
    const summary = {
      ...rest,
      readSummary: {
        count: reads.length,
        distinctPaths: new Set(reads.map((read) => read.path)).size,
        kinds: counts(reads.map((read) => read.kind)),
        outcomes: counts(reads.map((read) => read.outcome)),
        bindings: counts(reads.map((read) => read.binding ?? 'unspecified')),
        reasons: counts(reads.flatMap((read) => (read.reason === null ? [] : [read.reason]))),
        details: 'Full read paths, hashes and source bindings are in the supplied diagnostic audit.',
      },
      notableReads: reads.filter(
        (read) => read.outcome !== 'read' || read.reason !== null || read.binding === 'changed',
      ),
    };
    return [{ ...item, diagnostics: wrapper.diagnostics ? { ...wrapper, diagnostics: summary } : summary }];
  });
}

/** Keep the supplied audit alive until the invocation settles, including retries and cancellation. */
export async function prepareDiagnosticPrompt(
  diagnostics: readonly unknown[] | undefined,
  build: (diagnostics: unknown[] | undefined) => Promise<string>,
  signal?: AbortSignal,
): Promise<string | PreparedStagePrompt> {
  signal?.throwIfAborted();
  if (!diagnostics?.length) return build(diagnostics ? [...diagnostics] : undefined);
  const summary = summarizePromptDiagnostics(diagnostics);
  const text = JSON.stringify(diagnostics);
  if (JSON.stringify(summary).length >= text.length) return build([...diagnostics]);
  const directory = await mkdtemp(join(tmpdir(), 'experiences-diagnostic-audit-'));
  const path = join(directory, 'diagnostics.json');
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(path, text, { encoding: 'utf8', mode: 0o400, signal });
    signal?.throwIfAborted();
    const prompt = await build([
      ...summary,
      {
        kind: 'diagnostic-audit',
        representation: 'summary-with-full-audit',
        path,
        sha256: createHash('sha256').update(text).digest('hex'),
        byteLength: Buffer.byteLength(text, 'utf8'),
        count: diagnostics.length,
      },
    ]);
    signal?.throwIfAborted();
    return {
      text: [
        `Supplied immutable diagnostic audit: ${JSON.stringify(path)}.`,
        'Diagnostics are summarized in the task input; the full original receipts remain in this JSON array.',
        'Read-only shell or file tools may inspect this supplied audit even when repository filesystem access is forbidden; this exception permits only the supplied audit, never live repository access or file modification.',
        'Query specific receipts when needed instead of printing the whole audit. Summarization does not improve coverage; missing configurations, excluded source, unresolved references and unverified bindings remain unknown.',
        prompt,
      ].join('\n'),
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
