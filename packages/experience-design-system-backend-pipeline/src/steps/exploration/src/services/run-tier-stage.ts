import type { TierStageResult } from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { parseTierOutput } from '../parsers/parse-tier-output.js';
import type { TierStageRequest } from '../types.js';
import { propertySourceEvidence } from '../helpers/property-source-evidence.js';
export async function runTierStage(request: TierStageRequest): Promise<TierStageResult> {
  const hypotheses: Extract<TierStageResult, { ok: true }>['hypotheses'] = [];
  const attempts: TierStageResult['attempts'] = [];
  const pending = [...request.disagreements];
  if (new Set(pending.map((entry) => entry.id)).size !== pending.length) throw new Error('Duplicate disagreement IDs');
  while (pending.length) {
    const batch = pending.splice(0, 16);
    const result = await runStageWithRetries(
      { ...request, workIds: batch.map((entry) => entry.id) },
      'tier',
      () =>
        buildPrompt({
          skill: 'tier',
          mode: 'autonomous',
          existingComponentsInline: request.existingComponentsInline,
          existingTokensInline: request.existingTokensInline,
          outDir: request.outDir,
          stageAssignmentInline: JSON.stringify({ ids: batch.map((entry) => entry.id), identity: request.identity }),
          stageInputInline: JSON.stringify({
            disagreements: batch,
            propertyEvidence: propertySourceEvidence(request.representationProposalSources, batch),
            source: request.sourceInput,
            sourceRefs: request.sourceRefs,
            existingContext: request.existingContextStatus,
          }),
          skillContentOverride: request.skillContentOverride,
          skillPathOverride: request.skillPathOverride,
        }),
      (output) => {
        const parsed = parseTierOutput(output, batch);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.hypotheses;
      },
    );
    attempts.push(...result.attempts);
    if (!result.ok) return { ok: false, error: result.error, attempts };
    hypotheses.push(...result.value);
  }
  return { ok: true, hypotheses, attempts };
}
