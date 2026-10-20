import type { VerifyStageResult, VerifyAttempt, VerifiedItem } from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { parseVerifyOutput } from '../parsers/parse-verify-output.js';
import type { VerifyStageRequest } from '../types.js';
export async function runVerifyStage(request: VerifyStageRequest): Promise<VerifyStageResult> {
  const items: VerifiedItem[] = [],
    attempts: VerifyAttempt[] = [];
  for (const work of request.components) {
    if (!work.items.length) continue;
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
          outDir: request.outDir,
          stageAssignmentInline: JSON.stringify({
            component: work.component,
            source: work.source,
            itemIds: work.items.map((item) => item.itemId),
            identity: request.identity,
          }),
          stageInputInline: JSON.stringify({ work, source: request.sourceInput }),
          skillContentOverride: request.skillContentOverride,
          skillPathOverride: request.skillPathOverride,
        }),
      (output) => {
        const parsed = parseVerifyOutput(output, work, request.sourceInput);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.items;
      },
    );
    attempts.push(...result.attempts.map((attempt) => ({ ...attempt, component: work.component })));
    if (!result.ok) return { ok: false, component: work.component, error: result.error, attempts };
    items.push(...result.value);
  }
  return { ok: true, items, attempts };
}
