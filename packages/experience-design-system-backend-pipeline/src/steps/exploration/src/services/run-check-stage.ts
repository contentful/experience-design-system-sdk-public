import type {
  CheckStageResult,
  VerifiedItem,
  EvidenceCheck,
  VerifyAttempt,
} from '@contentful/experience-design-system-types';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { buildCheckWork } from '../helpers/build-check-work.js';
import { parseCheckOutput } from '../parsers/parse-check-output.js';
import { runStageWork } from '../helpers/run-stage-work.js';
import type { CheckStageRequest } from '../types.js';
import { propertySourceEvidence } from '../helpers/property-source-evidence.js';
import { prepareIndexedExplorationPrompt } from './indexed-exploration-prompt.js';
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
  const results = await runStageWork(
    buildCheckWork(request.components, request.verified, request.sourceInput),
    request.concurrency,
    async (work) => {
      const result = await runStageWithRetries(
        {
          ...request,
          preserveConversation: true,
          component: work.component,
          source: work.source,
          workIds: work.entries.map((entry) => entry.checkId),
          onAttempt: (attempt) => request.onAttempt?.({ ...attempt, component: work.component }),
        },
        'check',
        () =>
          prepareIndexedExplorationPrompt(
            {
              signal: request.signal,
              skill: 'check',
              mode: 'autonomous',
              existingComponentsInline: request.existingComponentsInline,
              existingTokensInline: request.existingTokensInline,
              outDir: request.outDir,
              stageAssignmentInline: JSON.stringify({
                component: work.component,
                source: work.source,
                checkIds: work.entries.map((entry) => entry.checkId),
                identity: request.identity,
              }),
              skillContentOverride: request.skillContentOverride,
              skillPathOverride: request.skillPathOverride,
            },
            {
              ...work,
              sourceInput: request.sourceInput,
              propertyEvidence: propertySourceEvidence(request.representationProposalSources, [work]),
              existingContext: request.existingContextStatus,
            },
            { kind: 'check', work },
          ),
        (output) => {
          const parsed = parseCheckOutput(output, work);
          if (!parsed.ok) throw new Error(parsed.error);
          return parsed.checks;
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
  for (const result of results) if (result?.ok) checks.push(...result.value);
  return { ok: true, items: applyChecks(request.verified, checks), checks, attempts };
}
