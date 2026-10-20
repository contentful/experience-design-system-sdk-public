import {
  CANDIDATE_FREE_SCOPES,
  EXPLORE_SCOPES,
  type ExploreStageResult,
  type ExploreScopeResult,
  type ExploreAttempt,
  type KnownComponent,
  type ExploreReportCoverage,
} from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { parseExploreOutput } from '../parsers/parse-explore-output.js';
import { assertUnique } from '../helpers/identity.js';
import type { ExploreStageRequest } from '../types.js';
import { loadStageContext } from '../helpers/load-stage-context.js';
import { projectExplorationSourceInput } from '../../../../source-evidence/shared-source.js';
export async function runExploreStage(request: ExploreStageRequest): Promise<ExploreStageResult> {
  assertUnique(request.scopes, 'requested scopes');
  if (request.scopes.some((scope) => !EXPLORE_SCOPES.includes(scope))) throw new Error('Unknown exploration scope');
  const scopes: ExploreScopeResult[] = [];
  let context: ReturnType<typeof loadStageContext> | undefined;
  for (const scope of request.scopes) {
    const candidateFree = (CANDIDATE_FREE_SCOPES as readonly string[]).includes(scope);
    let requestedComponents = request.requestedComponents;
    const result = await runStageWithRetries(
      { ...request, onAttempt: (attempt) => request.onAttempt?.({ ...attempt, scope }) },
      scope,
      async () => {
        const loadedContext = await (context ??= loadStageContext(request).catch((error: unknown) => {
          context = undefined;
          throw error;
        }));
        const raw = JSON.parse(request.rawComponentsInline) as Array<Record<string, unknown>>;
        if (!Array.isArray(raw)) throw new Error('Exploration components must be an array');
        if (!requestedComponents && raw.length)
          requestedComponents = raw.map((component): KnownComponent => {
            if (typeof component.name !== 'string' || typeof component.source !== 'string')
              throw new Error('Assigned exploration component/source identity missing');
            const componentId = component.component_id ?? component.componentId;
            if (componentId !== undefined && typeof componentId !== 'string')
              throw new Error('Assigned component identity invalid');
            return {
              name: component.name,
              source: component.source,
              ...(componentId !== undefined ? { componentId } : {}),
            };
          });
        let sourceInput =
          candidateFree && request.sourceInput
            ? {
                ...request.sourceInput,
                observations: { accepted: [], rejected: [] },
                omittedObservations:
                  (request.sourceInput.omittedObservations ?? 0) +
                  request.sourceInput.observations.accepted.length +
                  request.sourceInput.observations.rejected.length,
              }
            : request.sourceInput;
        if (candidateFree && sourceInput?.projectionBounds)
          sourceInput = projectExplorationSourceInput(sourceInput, sourceInput.projectionBounds.maxBytes);
        const sharedSource =
          request.sharedSource && !sourceInput
            ? candidateFree
              ? { ...request.sharedSource, observations: { accepted: [], rejected: [] } }
              : request.sharedSource
            : undefined;
        return buildPrompt({
          sharedSource,
          sourceProjectionMaxBytes: request.maxPromptBytes,
          skill: scope.startsWith('components-') ? 'explore-components' : 'explore-inventory',
          mode: 'autonomous',
          outDir: request.outDir,
          stageAssignmentInline: JSON.stringify({
            scope,
            identity: request.identity,
            candidateFree,
            requestedComponents,
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
            rendererReference: loadedContext.rendererReference,
            existingModel: loadedContext.existingModel,
            existingContext: request.existingContextStatus,
            projectRoot: request.projectRoot,
            repositoryAccess: request.projectRoot
              ? { status: 'unavailable', reason: 'Repository tools are not supplied by this invoker contract.' }
              : undefined,
            callSites: candidateFree ? undefined : loadedContext.callSites,
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
        const parsed = parseExploreOutput(
          output,
          scope,
          candidateFree ? [] : request.slotCandidates,
          requestedComponents,
        );
        if (!parsed.ok) throw new Error(parsed.error);
        const coverage: ExploreReportCoverage | undefined = requestedComponents
          ? {
              requested: requestedComponents.map((component) => ({ ...component })),
              answered: parsed.companion.components.map(({ name, source, componentId }) => ({
                name,
                source,
                ...(componentId !== undefined ? { componentId } : {}),
              })),
              excluded: parsed.companion.components
                .filter((component) => component.included === false)
                .map(({ name, source, componentId }) => ({
                  name,
                  source,
                  ...(componentId !== undefined ? { componentId } : {}),
                })),
              complete: true,
            }
          : undefined;
        return { companion: parsed.companion, report: parsed.report || output, ...(coverage ? { coverage } : {}) };
      },
      async ({ companion, report, coverage }, attempts) => {
        await request.onScopeComplete?.({
          scope,
          report,
          companion,
          ...(coverage ? { coverage } : {}),
          attempts: attempts.map((attempt) => ({ ...attempt, scope })),
        });
      },
    );
    const attempts = result.attempts.map((attempt) => ({ ...attempt, scope })) as ExploreAttempt[];
    if (!result.ok) return { ok: false, scope, attempts, error: result.error, scopes };
    scopes.push({
      scope,
      report: result.value.report,
      companion: result.value.companion,
      ...(result.value.coverage ? { coverage: result.value.coverage } : {}),
      attempts,
    });
  }
  return { ok: true, scopes };
}
