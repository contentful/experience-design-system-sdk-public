import type { VerifyStageResult, VerifyAttempt, VerifiedItem } from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { parseVerifyOutput } from '../parsers/parse-verify-output.js';
import { runStageWork } from '../helpers/run-stage-work.js';
import type { VerifyStageRequest } from '../types.js';
import { propertySourceEvidence } from '../helpers/property-source-evidence.js';
export async function runVerifyStage(request: VerifyStageRequest): Promise<VerifyStageResult> {
  const items: VerifiedItem[] = [],
    attempts: VerifyAttempt[] = [];
  const workItems = request.components.filter((work) => work.items.length);
  const results = await runStageWork(
    workItems,
    request.concurrency,
    async (work) => {
      const result = await runStageWithRetries(
        {
          ...request,
          component: work.component,
          source: work.source,
          workIds: work.items.map((item) => item.itemId),
          onAttempt: (attempt) => request.onAttempt?.({ ...attempt, component: work.component }),
        },
        'verify',
        () =>
          buildPrompt({
            skill: 'verify',
            mode: 'autonomous',
            existingComponentsInline: request.existingComponentsInline,
            existingTokensInline: request.existingTokensInline,
            outDir: request.outDir,
            stageAssignmentInline: JSON.stringify({
              component: work.component,
              source: work.source,
              itemIds: work.items.map((item) => item.itemId),
              identity: request.identity,
            }),
            stageInputInline: JSON.stringify({
              work,
              propertyEvidence: propertySourceEvidence(request.representationProposalSources, [work]),
              source: request.sourceInput,
              existingContext: request.existingContextStatus,
            }),
            skillContentOverride: request.skillContentOverride,
            skillPathOverride: request.skillPathOverride,
          }),
        (output) => {
          const parsed = parseVerifyOutput(output, work, request.sourceInput);
          if (!parsed.ok) throw new Error(parsed.error);
          return parsed.items;
        },
      );
      return { ...result, component: work.component };
    },
    request.signal,
  );
  for (const result of results)
    if (result) attempts.push(...result.attempts.map((attempt) => ({ ...attempt, component: result.component })));
  const failed = results.find((result) => result && !result.ok);
  if (failed && !failed.ok) return { ok: false, component: failed.component, error: failed.error, attempts };
  for (const result of results) if (result?.ok) items.push(...result.value);
  return { ok: true, items, attempts };
}
