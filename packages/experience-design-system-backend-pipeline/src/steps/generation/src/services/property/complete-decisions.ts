import {
  accountClassificationCalls,
  parseClassificationToolLines,
  type ClassificationToolCall,
  type DecisionInventory,
} from '@contentful/experience-design-system-types';
import { abortableDelay, throwIfAborted } from '../../../../../helpers/abort.js';

export interface CompleteDecisionOperation {
  originalPrompt: string;
  inventory: DecisionInventory;
  timeoutMs: number;
  signal?: AbortSignal;
  backoffMs?: number;
  now?: () => number;
  validate?: (call: ClassificationToolCall) => void;
  invoke: (request: {
    prompt: string;
    timeoutMs: number;
    signal: AbortSignal;
    attempt: number;
  }) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;
}
export async function generateCompleteDecisions(
  options: CompleteDecisionOperation,
): Promise<{ calls: ClassificationToolCall[]; diagnostics: string[]; complete: boolean }> {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + options.timeoutMs;
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(options.timeoutMs)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let accepted: ClassificationToolCall[] = [];
  let previousResponse = '';
  let diagnostics: string[] = [];
  let missing = accountClassificationCalls(options.inventory, []).missing;
  for (let attempt = 1; attempt <= 2; attempt++) {
    throwIfAborted(options.signal);
    if (attempt > 1 && options.backoffMs) {
      if (now() + options.backoffMs >= deadline)
        return { calls: accepted, diagnostics: [...diagnostics, 'Operation deadline exhausted'], complete: false };
      try {
        await abortableDelay(options.backoffMs, signal);
      } catch {
        throwIfAborted(options.signal);
        return { calls: accepted, diagnostics: [...diagnostics, 'Operation deadline exhausted'], complete: false };
      }
    }
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0 || timeout.aborted)
      return { calls: accepted, diagnostics: [...diagnostics, 'Operation deadline exhausted'], complete: false };
    const prompt =
      attempt === 1
        ? options.originalPrompt
        : `${options.originalPrompt}\n\nCorrection request:\n${JSON.stringify({ acceptedDecisions: accepted, missingOrRejectedSubjects: missing, diagnostics, previousResponse })}\nReturn only decisions for missing or rejected subjects. Preserve accepted decisions and the original source exactly.`;
    let result;
    try {
      let onAbort: (() => void) | undefined;
      const interrupted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Operation aborted'));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        result = await Promise.race([options.invoke({ prompt, timeoutMs: remaining, signal, attempt }), interrupted]);
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    } catch (error) {
      throwIfAborted(options.signal);
      diagnostics = [error instanceof Error ? error.message : 'Invocation failed'];
      if (timeout.aborted)
        return { calls: accepted, diagnostics: [...diagnostics, 'Operation deadline exhausted'], complete: false };
      continue;
    }
    throwIfAborted(options.signal);
    previousResponse = result.stdout;
    if (result.timedOut || now() >= deadline || timeout.aborted)
      return { calls: accepted, diagnostics: ['Operation deadline exhausted'], complete: false };
    if (result.exitCode !== 0) {
      diagnostics = [`Agent exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`];
      continue;
    }
    const parsed = parseClassificationToolLines(result.stdout);
    diagnostics = [...parsed.warnings];
    const valid: ClassificationToolCall[] = [];
    for (const call of parsed.calls) {
      try {
        options.validate?.(call);
        valid.push(call);
      } catch (error) {
        diagnostics.push(error instanceof Error ? error.message : 'Invalid source-bound decision');
      }
    }
    const accounting = accountClassificationCalls(options.inventory, [...accepted, ...valid]);
    diagnostics.push(...accounting.issues);
    missing = accounting.missing;
    if (!diagnostics.length && accounting.complete)
      return { calls: accounting.accepted, diagnostics: [], complete: true };
    // Accepted current-invocation decisions are immutable even when correction conflicts.
    const previousKeys = new Set(
      accepted.map((call) =>
        call.tool === 'classify_component'
          ? 'component'
          : call.tool === 'classify_slot'
            ? `slot:${call.slot}`
            : `property:${call.prop}`,
      ),
    );
    accepted = [
      ...accepted,
      ...accounting.accepted.filter(
        (call) =>
          !previousKeys.has(
            call.tool === 'classify_component'
              ? 'component'
              : call.tool === 'classify_slot'
                ? `slot:${call.slot}`
                : `property:${call.prop}`,
          ),
      ),
    ];
    diagnostics.push(...missing.map((subject) => `Missing decision ${subject}`));
  }
  return { calls: accepted, diagnostics, complete: false };
}
