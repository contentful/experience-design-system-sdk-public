import { EvidenceCheckSchema, type EvidenceCheck } from '@contentful/experience-design-system-types';
import { parseJsonOutput } from './parse-explore-output.js';
import { assertUnique } from '../helpers/identity.js';
import type { CheckWork } from '../helpers/build-check-work.js';
import { explorationWorkCoverage } from '../helpers/exploration-diagnostics.js';
export type ParsedCheckOutput = { ok: true; checks: EvidenceCheck[] } | { ok: false; error: string };
export function parseCheckOutput(output: string, work: CheckWork): ParsedCheckOutput {
  try {
    const raw = parseJsonOutput(output) as { checks?: unknown };
    if (!Array.isArray(raw.checks)) throw new Error('Missing independent checks');
    const checks = raw.checks.map((value) => EvidenceCheckSchema.parse(value));
    assertUnique(
      checks.map((check) => check.checkId),
      'check IDs',
    );
    if (
      checks.length !== work.entries.length ||
      checks.some(
        (check) =>
          check.component !== work.component ||
          check.source !== work.source ||
          !work.entries.some((entry) => entry.checkId === check.checkId && entry.itemId === check.itemId),
      )
    )
      throw new Error(
        `Check IDs must exactly cover requested work for ${work.component} (${work.source}): ${explorationWorkCoverage(
          work.entries.map((entry) => entry.checkId),
          checks.map((check) => check.checkId),
        )} Expected check/item pairs: ${JSON.stringify(work.entries.map(({ checkId, itemId }) => ({ checkId, itemId })))}; received identities: ${JSON.stringify(checks.map(({ checkId, itemId, component, source }) => ({ checkId, itemId, component, source })))}`,
      );
    return { ok: true, checks };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
