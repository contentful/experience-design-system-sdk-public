import {
  accountClassificationCalls,
  parseClassificationToolLines,
  REPRESENTATION_PROPOSAL_EVIDENCE_FIELDS,
  hasPropertyRepresentation,
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
  const isPending = (key: string, call: ClassificationToolCall): boolean =>
    pending.has(key) || (call.tool === 'classify_prop' && !hasPropertyRepresentation(call));
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
    complete:
      complete &&
      !pending.size &&
      [...accepted.values()].every((call) => call.tool !== 'classify_prop' || hasPropertyRepresentation(call)),
    representationsComplete:
      complete &&
      !pending.size &&
      [...accepted.values()].every((call) => call.tool !== 'classify_prop' || hasPropertyRepresentation(call)),
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
    const proposalEvidenceChannels = Object.fromEntries(
      Object.entries(REPRESENTATION_PROPOSAL_EVIDENCE_FIELDS).map(([channel, member]) => [
        channel,
        {
          type: 'array',
          item: {
            nodeId: '<current source node id>',
            [member]: member === 'statement' ? '<source-grounded statement string>' : '<JSON observation value>',
          },
        },
      ]),
    );
    const originalPrompt = `## Required decision inventory

The following host-owned inventory is the exact set of subjects validated for this component. Source evidence and advisory prop lists explain these subjects but do not change this inventory.
${JSON.stringify(options.inventory)}

- Emit exactly one classify_component.
- Each name in properties requires exactly one classify_prop or reasoned exclude_prop, even when absent from the advisory props or also used as a slot name.
- Each name in slots requires exactly one classify_slot. A slot accounts for a source property only through an explicit sourceInput association in this inventory; that owned property is already omitted from properties. Matching names alone do not establish ownership.
- Every classify_prop requires cdf_category set to content, design or state and either a supported native cdf_type or a source-bound representation_selection. An input without either representation cannot finish generation. Use source evidence to select the simplest compatible editable representation; never infer a category or invent a type just to satisfy validation.
- Preserve compiler nullability independently from the authoring representation. Null is not automatically optional. When source behavior establishes that null and omission are equivalent, choose the underlying editable type, preserve declared requiredness, and include null_handling [{sourceNodeId, handling: "omit-equivalent", reason}] plus the current source_revision and source_node_id. The judgment must identify the nullable union and explain defaults, comparisons, forwarding and output effects from supplied evidence. Use "distinct" or "unknown" when equivalence is not established; never substitute empty strings, false, zero or empty containers for null. Ordinary scalar fields cannot carry null defaults; an omission-equivalent source null default stays in source evidence rather than the editable default.
- Decide authorability before representation. Use exclude_prop with a nonblank source-grounded reason when the verified declaration and complete implementation establish that an input is neither read nor forwarded on any path. Explain that evidence even when its declared type is unknown. Check aliases, rest/spread forwarding, computed access and delegation; unresolved paths prevent an unused-input conclusion. Unrelated partial source coverage does not invalidate complete local evidence. Unknown type, no representation candidate or an empty source-use list alone never justifies exclusion.
- An unresolved classify_prop still requires cdf_category and a nonblank reason, but must omit required and every other representation companion until cdf_type or representation_selection is chosen. Source requiredness remains in the supplied evidence. This is an incomplete draft, not successful generation.

${options.representationValidation ? `## Current property representation identities\n${JSON.stringify(buildRepresentationContext({ ...options.representationValidation, inventory: options.inventory }))}\nSource-bound proposals must copy the current identities and cite these output-use references; mapper readiness remains caller-owned.` : ''}

## Source-derived model selection

When native fields cannot preserve a structured input, select its supplied component-model candidate in the classify_prop call:
{"tool":"classify_prop","prop":"<exact source property>","cdf_category":"content","representation_selection":{"strategy":"component-model","candidateId":"<id from this property's analysisRepresentationCandidates>"},"source_revision":"<current sourceRevision>","source_node_id":"<current nodeId>","description":"<what this input supplies>","reason":"<source-grounded modeling judgment>"}
Copy the current candidate id and source identity exactly. Prefer native Record or Array<Record> when the complete source value fits the category and target position. For the model route omit cdf_type and all native definition companions, including fields, items and representation_proposal. The host derives compact models for editable data, represents model arrays as ordered slots, and records optional unions and single-field structural envelopes as reconstruction mappings where instance boundaries can be preserved. It retains recursive references, nested collection grouping, nullable/empty element positions, defaults and every logical source node. Do not create Components or prescribe a model count from nullable syntax, names or frameworks. A generated model slot accounts for this property through its plan; do not add a classify_slot call or change the source-slot inventory. Defaults and null_handling may be supplied when source-grounded; requiredness remains compiler-owned. Keep deployment and rendering requirements explicit in the plan; deferred runtime support does not prevent completion of a valid local model definition. Opaque or incomplete source graphs still cannot complete.

## Exact representation_proposal wire format

Include a proposal only for the representation selected in this classify_prop call, never for a different alternative. Its desiredType must equal cdf_type exactly (including case), desiredDefinition.type must equal desiredType, and key and name must both equal the exact source property. desiredDefinition is the complete target definition for that same call, including its description, requiredness and any other selected definition metadata. Copy the current componentId, propertyId, sourceRevision and sourceNodeIds from the supplied identities.
The evidence channels have these exact array-item shapes:
${JSON.stringify(proposalEvidenceChannels)}
Use [] for an evidence channel with no supplied evidence. Do not emit constraint objects, free-text lists or an invented schema in these channels. Each item must cite a current source node. Keep the nonempty source-grounded judgment string separate from those evidence lists. compatibility contains status (judged-compatible, unresolved or contradicted), sourceUseRefs (current reference strings) and unresolvedRequirements (nonempty requirement strings, or []). Readiness is host-owned; a correctly shaped proposal does not prove compatibility or mapper support.

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
              acceptedDecisions: [...accepted.entries()]
                .filter(([key, call]) => !isPending(key, call))
                .map(([, call]) => call),
              pendingSemanticDecisions: [...accepted.entries()]
                .filter(([key, call]) => isPending(key, call))
                .map(([, call]) => call),
              pendingRepresentations: [...pending.values()],
              missingOrRejectedSubjects: missing,
              diagnostics,
              previousResponse,
            })}\nReturn only decisions for missing/rejected subjects and the reported pending representations. Preserve successful decisions and the original source exactly. Missing or parser-rejected subjects have no accepted semantic decision: reconsider their authorability against the supplied source, including a reasoned exclude_prop when complete implementation evidence establishes that the input is unused. This does not permit excluding unknown or unsupported inputs merely to pass validation. Repair only representation metadata on pendingSemanticDecisions: preserve the property, category, description and source identity; do not replace them with exclusions. Every retained property must select a native cdf_type or a supplied source-bound component-model candidate through representation_selection. Resolve null handling from source behavior rather than demanding an editor control for every TypeScript union member. If compatibility remains unresolved, retain the chosen type and explain the concrete limitation in reason; validation will keep the component incomplete rather than silently completing it. Without a representation choice, omit required and all other representation companions.\n\n${originalPrompt}`;
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
      diagnostics.push(
        ...parsed.calls.flatMap((call) =>
          call.tool === 'classify_prop' && !hasPropertyRepresentation(call)
            ? [
                `property:${call.prop}: cdf_type or a source-bound model selection must be selected before generation completes`,
              ]
            : [],
        ),
      );
      const candidates = new Map(accepted);
      const candidateFeedback = new Map(pending);
      for (const parsedCall of parsed.calls) {
        const key = subjectKey(parsedCall);
        const previous = accepted.get(key);
        let call = parsedCall;
        if (previous) {
          if (!isPending(key, previous)) {
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
          if (call.tool === 'classify_prop' && call.representation_selection && !options.representationValidation)
            throw new Error('Model selection requires current source validation evidence');
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
      if (!diagnostics.length && accounting.complete && !pending.size) return finish(true);
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
