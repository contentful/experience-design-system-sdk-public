import {
  VerifiedItemSchema,
  type VerifyComponentWork,
  type VerifiedItem,
  type ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import { parseJsonOutput } from './parse-explore-output.js';
import { assertUnique } from '../helpers/identity.js';
import { checkBoundEvidence } from '../helpers/check-evidence.js';
import { explorationWorkCoverage } from '../helpers/exploration-diagnostics.js';
export { checkEvidence } from '../helpers/check-evidence.js';
export type ParsedVerifyOutput = { ok: true; items: VerifiedItem[] } | { ok: false; error: string };
export function parseVerifyOutput(
  output: string,
  work: VerifyComponentWork,
  sourceInput?: ExplorationSourceInput,
): ParsedVerifyOutput {
  try {
    const raw = parseJsonOutput(output) as { items?: unknown };
    if (!Array.isArray(raw.items)) throw new Error('Missing verified items');
    const items: VerifiedItem[] = raw.items.map((value) => VerifiedItemSchema.parse(value));
    assertUnique(
      items.map((item) => item.itemId),
      'verified item IDs',
    );
    assertUnique(
      work.items.map((item) => item.itemId),
      'requested item IDs',
    );
    if (items.length !== work.items.length)
      throw new Error(
        `Verified items must cover every requested item for ${work.component} (${work.source}): ${explorationWorkCoverage(
          work.items.map((item) => item.itemId),
          items.map((item) => item.itemId),
        )}`,
      );
    for (const item of items) {
      const requested = work.items.find((requested) => requested.itemId === item.itemId);
      if (!requested || item.component !== work.component || item.source !== work.source)
        throw new Error(
          `Verified item identity mismatch: received ${JSON.stringify({ itemId: item.itemId, component: item.component, source: item.source })}; expected component ${work.component} (${work.source}), item IDs ${JSON.stringify(work.items.map((item) => item.itemId))}`,
        );
      if (item.outcome === 'conflicting') continue;
      const expected = requested.claims.map((claim) => claim.path);
      const resolutions = item.resolved ?? [];
      const paths = resolutions.map((resolution) => resolution.path);
      const complete =
        paths.length === expected.length &&
        new Set(paths).size === paths.length &&
        paths.every((path) => expected.includes(path)) &&
        resolutions.every((resolution) => Object.hasOwn(resolution, 'value') && resolution.value !== undefined);
      const sourceComplete = sourceInput
        ? sourceInput.promptCoverage === 'complete-within-declared-bound' &&
          sourceInput.coverage === 'complete-within-declared-bound'
        : work.sourceRef?.sourceEvidence?.coverage === 'complete-within-declared-bound';
      if (!complete || !sourceComplete || !checkBoundEvidence(item.evidence, work, sourceInput)) {
        item.outcome = 'conflicting';
        item.downgraded = true;
        item.reason = 'Source binding or complete resolution could not be established.';
      }
    }
    return { ok: true, items };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
