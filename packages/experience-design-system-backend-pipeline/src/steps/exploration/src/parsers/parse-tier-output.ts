import {
  TierHypothesisSchema,
  type ExplorationDisagreement,
  type TierHypothesis,
} from '@contentful/experience-design-system-types';
import { parseJsonOutput } from './parse-explore-output.js';
import { assertUnique } from '../helpers/identity.js';
export type ParsedTierOutput = { ok: true; hypotheses: TierHypothesis[] } | { ok: false; error: string };
export function parseTierOutput(output: string, disagreements: ExplorationDisagreement[]): ParsedTierOutput {
  try {
    const raw = parseJsonOutput(output) as { hypotheses?: unknown };
    if (!Array.isArray(raw.hypotheses)) throw new Error('Missing tier hypotheses');
    const hypotheses = raw.hypotheses.map((value) => TierHypothesisSchema.parse(value));
    const expected = disagreements.map((entry) => entry.id);
    const actual = hypotheses.flatMap((entry) => entry.disagreementIds);
    assertUnique(expected, 'disagreement IDs');
    assertUnique(actual, 'tier IDs');
    if (actual.length !== expected.length || actual.some((id) => !expected.includes(id)))
      throw new Error('Tier IDs do not exactly cover requested work');
    return { ok: true, hypotheses };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
