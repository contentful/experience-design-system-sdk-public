import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountClassificationCalls,
  parseClassificationToolLines,
  parseStrictJson,
  hasPropertyRepresentation,
  type ClassificationToolCall,
  type DecisionInventory,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { validateGenerationPropertyDecision } from './representation-feedback.js';
import { generationSubject, generationDraftDigest, mergeGenerationRepair } from './generation-decision-repair.js';

export interface RepresentationValidationEvidence {
  component: RawComponentDefinition;
  componentId?: string;
  inventory: DecisionInventory;
  acceptedDecisions?: readonly ClassificationToolCall[];
  pendingSubjects?: readonly string[];
}

/** Draft text is data; validation never reads the component's source paths or executes expressions. */
export function validateGenerationRepresentationDraft(evidence: RepresentationValidationEvidence, draft: string) {
  const parsed = parseClassificationToolLines(draft);
  const calls = new Map((evidence.acceptedDecisions ?? []).map((call) => [generationSubject(call), call]));
  const diagnostics = [...parsed.warnings];
  for (const call of parsed.calls) {
    const key = generationSubject(call);
    try {
      calls.set(key, mergeGenerationRepair(calls.get(key), call, evidence.pendingSubjects?.includes(key) ?? false));
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : 'Invalid repair');
    }
  }
  const accounting = accountClassificationCalls(evidence.inventory, [...calls.values()]);
  diagnostics.push(...accounting.issues);
  diagnostics.push(
    ...accounting.accepted.flatMap((call) =>
      call.tool === 'classify_prop' && !hasPropertyRepresentation(call)
        ? [
            `property:${call.prop}: cdf_type or a source-bound model selection must be selected before generation completes`,
          ]
        : [],
    ),
  );
  const representations = accounting.accepted.flatMap((call) => {
    if (call.tool !== 'classify_prop') return [];
    try {
      return [validateGenerationPropertyDecision(evidence.component, call, evidence.componentId)];
    } catch (error) {
      diagnostics.push(`${call.prop}: ${error instanceof Error ? error.message : 'Invalid source-bound decision'}`);
      return [];
    }
  });
  return {
    complete: accounting.complete && !diagnostics.length && representations.every((result) => result.state === 'ready'),
    representationsComplete:
      accounting.complete && !diagnostics.length && representations.every((result) => result.state === 'ready'),
    missingSubjects: accounting.missing,
    diagnostics,
    representations,
    draftDigest: generationDraftDigest(parsed.calls),
  };
}

async function main(): Promise<void> {
  if (![3, 5].includes(process.argv.length))
    throw new Error(
      'Supply immutable evidence, optionally attempt state and receipt paths; draft tool lines use stdin',
    );
  const evidence = parseStrictJson(
    await readFile(process.argv[2]!, 'utf8'),
  ) as unknown as RepresentationValidationEvidence;
  if (process.argv[3]) {
    const state = parseStrictJson(await readFile(process.argv[3], 'utf8')) as unknown as Pick<
      RepresentationValidationEvidence,
      'acceptedDecisions' | 'pendingSubjects'
    >;
    evidence.acceptedDecisions = state.acceptedDecisions;
    evidence.pendingSubjects = state.pendingSubjects;
  }
  let draft = '';
  for await (const chunk of process.stdin) draft += chunk.toString();
  const result = validateGenerationRepresentationDraft(evidence, draft);
  if (process.argv[4] && result.complete && result.representationsComplete)
    await appendFile(process.argv[4], `${JSON.stringify({ draftDigest: result.draftDigest })}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Draft validation failed'}\n`);
    process.exitCode = 1;
  });
}
