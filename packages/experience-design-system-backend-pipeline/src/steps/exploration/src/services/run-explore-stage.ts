import {
  CANDIDATE_FREE_SCOPES,
  EXPLORE_SCOPES,
  type ExploreStageResult,
  type ExploreScopeResult,
  type ExploreAttempt,
} from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { parseExploreOutput } from '../parsers/parse-explore-output.js';
import { assertUnique } from '../helpers/identity.js';
import type { ExploreStageRequest } from '../types.js';
export async function runExploreStage(request: ExploreStageRequest): Promise<ExploreStageResult> {
  assertUnique(request.scopes, 'requested scopes');
  if (request.scopes.some((scope) => !EXPLORE_SCOPES.includes(scope))) throw new Error('Unknown exploration scope');
  const scopes: ExploreScopeResult[] = [];
  for (const scope of request.scopes) {
    const candidateFree = (CANDIDATE_FREE_SCOPES as readonly string[]).includes(scope);
    const result = await runStageWithRetries(
      { ...request, onAttempt: (attempt) => request.onAttempt?.({ ...attempt, scope }) },
      scope,
      () => {
        const raw = JSON.parse(request.rawComponentsInline) as Array<Record<string, unknown>>;
        if (!Array.isArray(raw)) throw new Error('Exploration components must be an array');
        const sourceInput =
          candidateFree && request.sourceInput
            ? {
                ...request.sourceInput,
                observations: { accepted: [], rejected: [] },
                omittedObservations:
                  request.sourceInput.observations.accepted.length + request.sourceInput.observations.rejected.length,
              }
            : request.sourceInput;
        return buildPrompt({
          skill: scope.startsWith('components-') ? 'explore-components' : 'explore-inventory',
          mode: 'autonomous',
          outDir: request.outDir,
          stageAssignmentInline: JSON.stringify({
            scope,
            identity: request.identity,
            candidateFree,
            ...(candidateFree ? {} : { slotCandidates: request.slotCandidates }),
          }),
          stageInputInline: JSON.stringify({
            components: candidateFree
              ? raw.map(({ name, source, component_id, sourcePath, framework }) => ({
                  name,
                  source,
                  component_id,
                  sourcePath,
                  framework,
                }))
              : raw,
            sourceInput,
            sourceRefs: request.sourceRefs,
            rendererReference: request.rendererReferenceInline,
            callSites: candidateFree ? undefined : request.callSiteEvidenceInline,
            tokens: request.rawTokensInline,
            existingTokens: request.existingTokensInline,
            existingComponents: request.existingComponentsInline,
            tokensFilename: request.rawTokensFilename,
            propBuckets: candidateFree ? undefined : request.propBucketsInline,
          }),
          skillContentOverride: request.skillContentOverride,
          skillPathOverride: request.skillPathOverride,
        });
      },
      (output) => {
        const parsed = parseExploreOutput(output, scope, candidateFree ? [] : request.slotCandidates);
        if (!parsed.ok) throw new Error(parsed.error);
        return { companion: parsed.companion, report: parsed.report || output };
      },
      async ({ companion, report }, attempts) => {
        await request.onScopeComplete?.({
          scope,
          report,
          companion,
          attempts: attempts.map((attempt) => ({ ...attempt, scope })),
        });
      },
    );
    const attempts = result.attempts.map((attempt) => ({ ...attempt, scope })) as ExploreAttempt[];
    if (!result.ok) return { ok: false, scope, attempts, error: result.error, scopes };
    scopes.push({ scope, report: result.value.report, companion: result.value.companion, attempts });
  }
  return { ok: true, scopes };
}
