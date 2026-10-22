import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountClassificationCalls,
  parseClassificationToolLines,
  parseStrictJson,
  type DecisionInventory,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { validateGenerationPropertyDecision } from './representation-feedback.js';

export interface RepresentationValidationEvidence {
  component: RawComponentDefinition;
  componentId?: string;
  inventory: DecisionInventory;
}

/** Draft text is data; validation never reads the component's source paths or executes expressions. */
export function validateGenerationRepresentationDraft(evidence: RepresentationValidationEvidence, draft: string) {
  const parsed = parseClassificationToolLines(draft);
  const accounting = accountClassificationCalls(evidence.inventory, parsed.calls);
  const diagnostics = [...parsed.warnings, ...accounting.issues];
  diagnostics.push(
    ...accounting.accepted.flatMap((call) =>
      call.tool === 'classify_prop' && !call.cdf_type
        ? [`property:${call.prop}: cdf_type must be selected before generation completes`]
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
  };
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('Supply the immutable evidence file; draft JSON tool lines use stdin');
  const evidence = parseStrictJson(
    await readFile(process.argv[2]!, 'utf8'),
  ) as unknown as RepresentationValidationEvidence;
  let draft = '';
  for await (const chunk of process.stdin) draft += chunk.toString();
  process.stdout.write(`${JSON.stringify(validateGenerationRepresentationDraft(evidence, draft))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Draft validation failed'}\n`);
    process.exitCode = 1;
  });
}
