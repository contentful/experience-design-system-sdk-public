import { throwIfAborted } from '../../../../helpers/abort.js';
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
import type { PromptOptions } from '../../../../agents/types/prompts.js';
import { buildExploreCacheKey } from '../helpers/build-explore-cache-key.js';
import { propertySourceEvidence } from '../helpers/property-source-evidence.js';
import { prepareExplorationValidator } from './exploration-validator-artifact.js';
import {
  prepareExplorationEvidence,
  type PreparedExplorationEvidence,
} from '../../../../source-evidence/indexed-evidence/artifact.js';
export async function runExploreStage(request: ExploreStageRequest): Promise<ExploreStageResult> {
  if (request.rawComponents === undefined && request.rawComponentsInline === undefined)
    throw new Error('Exploration component inventory missing');
  assertUnique(request.scopes, 'requested scopes');
  if (request.scopes.some((scope) => !EXPLORE_SCOPES.includes(scope))) throw new Error('Unknown exploration scope');
  const scopes: ExploreScopeResult[] = [];
  let context: ReturnType<typeof loadStageContext> | undefined;
  const evidenceViews = new Map<boolean, PreparedExplorationEvidence>();
  try {
    for (const scope of request.scopes) {
      throwIfAborted(request.signal);
      request.onScopeStart?.(scope);
      const candidateFree = (CANDIDATE_FREE_SCOPES as readonly string[]).includes(scope);
      let requestedComponents = request.requestedComponents;
      let cacheKey: string | undefined;
      const result = await runStageWithRetries(
        { ...request, preserveConversation: true, onAttempt: (attempt) => request.onAttempt?.({ ...attempt, scope }) },
        scope,
        async () => {
          const loadedContext = await (context ??= loadStageContext(request).catch((error: unknown) => {
            context = undefined;
            throw error;
          }));
          let evidence = evidenceViews.get(candidateFree);
          if (!evidence) {
            evidence = await prepareExplorationEvidence(
              {
                rawComponentsInline: request.rawComponentsInline,
                rawComponents: request.rawComponents,
                candidateFree,
                input: {
                  sourceInput: request.sourceInput,
                  sharedSource: request.sourceInput ? undefined : request.sharedSource,
                  propertyEvidence: candidateFree
                    ? undefined
                    : propertySourceEvidence(request.representationProposalSources),
                  sourceRefs: request.sourceRefs,
                  rendererReference: loadedContext.rendererReference,
                  existingModel: loadedContext.existingModel,
                  existingContext: request.existingContextStatus,
                  projectRoot: request.projectRoot,
                  repositoryAccess: {
                    status: 'unavailable',
                    reason: 'Only supplied immutable evidence reader access is allowed.',
                  },
                  callSites: candidateFree ? undefined : loadedContext.callSites,
                  tokens: request.rawTokensInline,
                  existingTokens: request.existingTokensInline,
                  existingComponents: request.existingComponentsInline,
                  tokensFilename: request.rawTokensFilename,
                  propBuckets: candidateFree ? undefined : request.propBucketsInline,
                },
              },
              request.signal,
            );
            evidenceViews.set(candidateFree, evidence);
          }
          if (!requestedComponents) {
            const components = evidence.index.components as Array<{
              name: string;
              source: string;
              componentId?: string;
            }>;
            if (components.length)
              requestedComponents = components.map(
                ({ name, source, componentId }): KnownComponent => ({
                  name,
                  source,
                  ...(componentId !== undefined ? { componentId } : {}),
                }),
              );
          }
          const options: PromptOptions = {
            signal: request.signal,
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
            stageInputInline: JSON.stringify({ ...evidence.index, evidenceDigest: evidence.digest }),
            skillContentOverride: request.skillContentOverride,
            skillPathOverride: request.skillPathOverride,
          };
          cacheKey = request.responseCache ? await buildExploreCacheKey(options, request) : undefined;
          const prompt = await buildPrompt(options);
          return prepareExplorationValidator(
            prompt,
            {
              kind: 'explore',
              scope,
              slotCandidates: candidateFree ? [] : request.slotCandidates,
              requestedComponents,
              representationProposalSources: request.representationProposalSources,
            },
            request.signal,
            evidence.instructions,
          );
        },
        (output) => {
          const parsed = parseExploreOutput(
            output,
            scope,
            candidateFree ? [] : request.slotCandidates,
            requestedComponents,
            request.representationProposalSources,
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
        request.responseCache
          ? {
              key: () => cacheKey,
              load: request.responseCache.load,
              save: request.responseCache.save,
              hit: (key) => request.responseCache!.hit(key, scope),
            }
          : undefined,
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
  } finally {
    await Promise.all([...evidenceViews.values()].map((evidence) => evidence.dispose()));
  }
}
