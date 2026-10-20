import type {
  CheckStageResult,
  VerifiedItem,
  EvidenceCheck,
  VerifyAttempt,
} from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/index.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { buildCheckWork } from '../helpers/build-check-work.js';
import { parseCheckOutput } from '../parsers/parse-check-output.js';
import type { CheckStageRequest } from '../types.js';
export function applyChecks(verified: VerifiedItem[], checks: EvidenceCheck[]): VerifiedItem[] {
  return verified.map((item) => {
    if (item.outcome === 'conflicting') return item;
    const own = checks.filter(
      (check) => check.itemId === item.itemId && check.component === item.component && check.source === item.source,
    );
    return own.length === 1 && own[0]!.verdict === 'supports'
      ? item
      : {
          ...item,
          outcome: 'conflicting',
          downgraded: true,
          reason: 'Independent evidence support was not established.',
        };
  });
}
export async function runCheckStage(request: CheckStageRequest): Promise<CheckStageResult> {
  const checks: EvidenceCheck[] = [],
    attempts: VerifyAttempt[] = [];
  for (const work of buildCheckWork(request.components, request.verified, request.sourceInput)) {
    const result = await runStageWithRetries(
      {
        ...request,
        component: work.component,
        source: work.source,
        workIds: work.entries.map((entry) => entry.checkId),
        onAttempt: (attempt) => request.onAttempt?.({ ...attempt, component: work.component }),
      },
      'check',
      () =>
        buildPrompt({
          skill: 'check',
          mode: 'autonomous',
          outDir: request.outDir,
          stageAssignmentInline: JSON.stringify({
            component: work.component,
            source: work.source,
            checkIds: work.entries.map((entry) => entry.checkId),
            identity: request.identity,
          }),
          stageInputInline: JSON.stringify(work),
          skillContentOverride: request.skillContentOverride,
          skillPathOverride: request.skillPathOverride,
        }),
      (output) => {
        const parsed = parseCheckOutput(output, work);
        if (!parsed.ok) throw new Error(parsed.error);
        return parsed.checks;
      },
    );
    attempts.push(...result.attempts.map((attempt) => ({ ...attempt, component: work.component })));
    if (!result.ok) return { ok: false, component: work.component, error: result.error, attempts };
    checks.push(...result.value);
  }
  return { ok: true, items: applyChecks(request.verified, checks), checks, attempts };
}
