import {
  accountClassificationCalls,
  parseClassificationToolLines,
  type ClassificationToolCall,
  type DecisionInventory,
} from '@contentful/experience-design-system-types';
import { abortableDelay, throwIfAborted } from '../../../../../helpers/abort.js';
import { validateGenerationPropertyDecision, type PropertyRepresentationFeedback } from './representation-feedback.js';
import { createGenerationRepresentationValidator } from './representation-validator-artifact.js';
import type { RepresentationValidationEvidence } from './validate-representation-draft.js';
import { buildRepresentationContext } from './representation-context.js';

export interface CompleteDecisionOperation {
  originalPrompt: string;
  inventory: DecisionInventory;
  timeoutMs: number;
  signal?: AbortSignal;
  backoffMs?: number;
  now?: () => number;
  validate?: (call: ClassificationToolCall) => void;
  representationValidation?: Omit<RepresentationValidationEvidence, 'inventory'>;
  invoke: (request: {
    prompt: string;
    timeoutMs: number;
    signal: AbortSignal;
    attempt: number;
  }) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;
}

export interface CompleteDecisionResult {
  calls: ClassificationToolCall[];
  diagnostics: string[];
  complete: boolean;
  representationsComplete: boolean;
  representationFeedback: PropertyRepresentationFeedback[];
  representationValidatorAvailable: boolean;
}

const subjectKey = (call: ClassificationToolCall): string =>
  call.tool === 'classify_component'
    ? 'component'
    : call.tool === 'classify_slot'
      ? `slot:${call.slot}`
      : `property:${call.prop}`;

export async function generateCompleteDecisions(options: CompleteDecisionOperation): Promise<CompleteDecisionResult> {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + options.timeoutMs;
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(options.timeoutMs)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const accepted = new Map<string, ClassificationToolCall>();
  const pending = new Map<string, PropertyRepresentationFeedback>();
  let previousResponse = '';
  let diagnostics: string[] = [];
  const notes: string[] = [];
  let missing = accountClassificationCalls(options.inventory, []).missing;
  const finish = (complete: boolean, additional: string[] = []): CompleteDecisionResult => ({
    calls: [...accepted.values()],
    diagnostics: [
      ...diagnostics,
      ...notes,
      ...additional,
      ...[...pending.values()].map(
        (feedback) =>
          `Representation pending ${feedback.subject}: ${feedback.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
      ),
    ],
    complete,
    representationsComplete: complete && !pending.size,
    representationFeedback: [...pending.values()],
    representationValidatorAvailable: !!validator,
  });
  let validator: Awaited<ReturnType<typeof createGenerationRepresentationValidator>> | undefined;
  const invocations: Promise<unknown>[] = [];
  try {
    throwIfAborted(options.signal);
    if (options.representationValidation) {
      try {
        validator = await createGenerationRepresentationValidator(
          { ...options.representationValidation, inventory: options.inventory },
          signal,
        );
      } catch {
        throwIfAborted(options.signal);
        if (timeout.aborted) return finish(false, ['Operation deadline exhausted']);
        notes.push('Read-only representation validator unavailable; host validation remains authoritative');
      }
    }
    const originalPrompt = `## Required decision inventory

The following host-owned inventory is the exact set of subjects validated for this component. Source evidence and advisory prop lists explain these subjects but do not change this inventory.
${JSON.stringify(options.inventory)}

- Emit exactly one classify_component.
- Each name in properties requires exactly one classify_prop or reasoned exclude_prop, even when absent from the advisory props or also used as a slot name.
- Each name in slots requires exactly one classify_slot. A slot accounts for a source property only through an explicit sourceInput association in this inventory; that owned property is already omitted from properties. Matching names alone do not establish ownership.
- Every classify_prop requires cdf_category set to content, design or state, including decisions with unresolved representation. When cdf_type is omitted, also omit required, values, token_kind, default, default_intent, items and fields; retain the semantic category and a nonblank reason identifying the missing evidence or capability. Source requiredness and defaults remain in the independent evidence. Never infer a category just to satisfy validation.
- If source semantics justify excluding a property, use exclude_prop with a nonblank reason rather than a classify_prop missing its category.

${options.representationValidation ? `## Current property representation identities\n${JSON.stringify(buildRepresentationContext({ ...options.representationValidation, inventory: options.inventory }))}\nSource-bound proposals must copy the current identities and cite these output-use references; mapper readiness remains caller-owned.` : ''}

${validator?.instructions ?? notes.join('\n')}

${options.originalPrompt}`;
    for (let attempt = 1; attempt <= 2; attempt++) {
      throwIfAborted(options.signal);
      if (attempt > 1 && options.backoffMs) {
        if (now() + options.backoffMs >= deadline) return finish(false, ['Operation deadline exhausted']);
        try {
          await abortableDelay(options.backoffMs, signal);
        } catch {
          throwIfAborted(options.signal);
          return finish(false, ['Operation deadline exhausted']);
        }
      }
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0 || timeout.aborted) return finish(false, ['Operation deadline exhausted']);
      const prompt =
        attempt === 1
          ? originalPrompt
          : `Correction request:\n${JSON.stringify({
              acceptedDecisions: [...accepted.entries()].filter(([key]) => !pending.has(key)).map(([, call]) => call),
              pendingSemanticDecisions: [...accepted.entries()]
                .filter(([key]) => pending.has(key))
                .map(([, call]) => call),
              pendingRepresentations: [...pending.values()],
              missingOrRejectedSubjects: missing,
              diagnostics,
              previousResponse,
            })}\nReturn only decisions for missing/rejected subjects and the reported pending representations. Preserve successful decisions and the original source exactly. Repair only representation metadata on pending semantic decisions: preserve the property, category, description and source identity; do not replace them with exclusions. If unresolved, explain the concrete missing evidence or capability in reason and omit representation companions.\n\n${originalPrompt}`;
      let result;
      try {
        let onAbort: (() => void) | undefined;
        const interrupted = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('Operation aborted'));
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          const invocation = Promise.resolve().then(() => {
            throwIfAborted(signal);
            return options.invoke({ prompt, timeoutMs: remaining, signal, attempt });
          });
          invocations.push(invocation);
          result = await Promise.race([invocation, interrupted]);
        } finally {
          if (onAbort) signal.removeEventListener('abort', onAbort);
        }
      } catch (error) {
        throwIfAborted(options.signal);
        diagnostics = [error instanceof Error ? error.message : 'Invocation failed'];
        if (timeout.aborted) return finish(false, ['Operation deadline exhausted']);
        continue;
      }
      throwIfAborted(options.signal);
      previousResponse = result.stdout;
      if (result.timedOut || now() >= deadline || timeout.aborted)
        return finish(false, ['Operation deadline exhausted']);
      if (result.exitCode !== 0) {
        diagnostics = [`Agent exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`];
        continue;
      }
      const parsed = parseClassificationToolLines(result.stdout);
      diagnostics = [...parsed.warnings];
      const candidates = new Map(accepted);
      const candidateFeedback = new Map(pending);
      for (const parsedCall of parsed.calls) {
        const key = subjectKey(parsedCall);
        const previous = accepted.get(key);
        let call = parsedCall;
        if (previous) {
          if (!pending.has(key)) {
            diagnostics.push(`Duplicate or conflicting subject ${key}; accepted decision preserved`);
            continue;
          }
          if (
            previous.tool !== 'classify_prop' ||
            call.tool !== 'classify_prop' ||
            previous.cdf_category !== call.cdf_category ||
            (call.description !== undefined && call.description !== previous.description) ||
            (previous.source_revision !== undefined && previous.source_revision !== call.source_revision) ||
            (previous.source_node_id !== undefined && previous.source_node_id !== call.source_node_id)
          ) {
            diagnostics.push(`Representation repair changed retained semantics or source identity ${key}`);
            continue;
          }
          call = { ...call, ...(previous.description !== undefined ? { description: previous.description } : {}) };
        }
        try {
          options.validate?.(call);
          if (call.tool === 'classify_prop' && options.representationValidation) {
            const validation = validateGenerationPropertyDecision(
              options.representationValidation.component,
              call,
              options.representationValidation.componentId,
            );
            candidates.set(key, validation.retainedCall);
            if (validation.feedback) candidateFeedback.set(key, validation.feedback);
            else candidateFeedback.delete(key);
          } else candidates.set(key, call);
        } catch (error) {
          diagnostics.push(`${key}: ${error instanceof Error ? error.message : 'Invalid source-bound decision'}`);
        }
      }
      const accounting = accountClassificationCalls(options.inventory, [...candidates.values()]);
      diagnostics.push(...accounting.issues);
      missing = accounting.missing;
      for (const call of accounting.accepted) {
        const key = subjectKey(call);
        accepted.set(key, call);
        const feedback = candidateFeedback.get(key);
        if (feedback) pending.set(key, feedback);
        else pending.delete(key);
      }
      diagnostics.push(...missing.map((subject) => `Missing decision ${subject}`));
      throwIfAborted(options.signal);
      if (now() >= deadline || timeout.aborted) return finish(false, ['Operation deadline exhausted']);
      if (!diagnostics.length && accounting.complete && (!pending.size || attempt === 2)) return finish(true);
    }
    return finish(false);
  } finally {
    // Keep supplied evidence until every subprocess settles, including cancellation cleanup.
    if (validator) {
      const dispose = validator.dispose;
      const settled = Promise.allSettled(invocations).then(() => dispose());
      if (signal.aborted) void settled.catch(() => undefined);
      else await settled;
    }
  }
}
