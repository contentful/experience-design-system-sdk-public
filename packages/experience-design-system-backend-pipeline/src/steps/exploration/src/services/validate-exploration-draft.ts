import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExploreScope,
  KnownComponent,
  ExplorationDisagreement,
  VerifyComponentWork,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import { parseExploreOutput } from '../parsers/parse-explore-output.js';
import { parseTierOutput } from '../parsers/parse-tier-output.js';
import { parseVerifyOutput } from '../parsers/parse-verify-output.js';
import { parseCheckOutput } from '../parsers/parse-check-output.js';
import { parseModelComponentOutput, type ModelExplorationEvidence } from '../parsers/parse-model-component-output.js';
import type { CheckWork } from '../helpers/build-check-work.js';
import type { ExploreRepresentationProposalSource, SlotCandidates } from '../types.js';

export interface ExplorationScopeEvidence {
  kind: 'explore';
  scope: ExploreScope;
  slotCandidates?: SlotCandidates;
  requestedComponents?: readonly KnownComponent[];
  representationProposalSources?: readonly ExploreRepresentationProposalSource[];
}

export type ExplorationValidationEvidence =
  | ExplorationScopeEvidence
  | { kind: 'tier'; disagreements: ExplorationDisagreement[] }
  | { kind: 'verify'; work: VerifyComponentWork; sourceInput?: ExplorationSourceInput }
  | { kind: 'check'; work: CheckWork }
  | { kind: 'model'; evidence: ModelExplorationEvidence };

/** Use the host parser on draft data without reading or executing referenced source paths. */
export function validateExplorationDraft(evidence: ExplorationValidationEvidence, draft: string) {
  try {
    let result: { ok: true } | { ok: false; error: string };
    switch (evidence.kind) {
      case 'explore':
        result = parseExploreOutput(
          draft,
          evidence.scope,
          evidence.slotCandidates,
          evidence.requestedComponents,
          evidence.representationProposalSources,
        );
        break;
      case 'tier':
        result = parseTierOutput(draft, evidence.disagreements);
        break;
      case 'verify':
        result = parseVerifyOutput(draft, evidence.work, evidence.sourceInput);
        break;
      case 'check':
        result = parseCheckOutput(draft, evidence.work);
        break;
      case 'model':
        parseModelComponentOutput(draft, evidence.evidence);
        result = { ok: true };
        break;
      default:
        throw new Error('Unknown exploration validation kind');
    }
    return { valid: result.ok, diagnostics: result.ok ? [] : [result.error] };
  } catch (error) {
    return { valid: false, diagnostics: [error instanceof Error ? error.message : 'Invalid exploration draft'] };
  }
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('Supply immutable exploration evidence; draft output uses stdin');
  const evidence = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as ExplorationValidationEvidence;
  let draft = '';
  for await (const chunk of process.stdin) draft += chunk.toString();
  process.stdout.write(`${JSON.stringify(validateExplorationDraft(evidence, draft))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Exploration draft validation failed'}\n`);
    process.exitCode = 1;
  });
}
