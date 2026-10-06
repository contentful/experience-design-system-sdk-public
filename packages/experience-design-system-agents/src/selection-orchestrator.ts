import type { SelectionDecision, SelectionDiff, TieredSelectionDisagreement } from './selection-diff.js';
import type { SelectionPipelineResult } from './selection-pipeline.js';

type DeterminationSource = 'factual-verification' | 'debate';

export interface SelectionDetermination {
  disagreementId: string;
  decision: SelectionDecision;
  reason: string;
  resolvedBy: DeterminationSource;
}

interface FinalSelectionResult {
  componentKey: string;
  decision: SelectionDecision;
  reason: string;
  source: 'consensus' | DeterminationSource;
}

interface SelectionAssemblyReport {
  unresolvedCount: number;
  unresolved: string[];
  buildWarnings: string[];
}

export interface SelectionAssembly {
  selections: FinalSelectionResult[];
  report: SelectionAssemblyReport;
}

export function determineSelection(pipeline: SelectionPipelineResult): SelectionDetermination[] {
  const determinations: SelectionDetermination[] = [];

  for (const resolution of pipeline.factualResolutions) {
    if (resolution.decision === undefined) continue;
    determinations.push({
      disagreementId: resolution.disagreementId,
      decision: resolution.decision,
      reason: resolution.reason ?? 'Resolved by direct factual verification.',
      resolvedBy: 'factual-verification',
    });
  }

  for (const transcript of pipeline.debateTranscripts) {
    if (transcript.decision === undefined) continue;
    determinations.push({
      disagreementId: transcript.disagreementId,
      decision: transcript.decision,
      reason: transcript.reason ?? 'Resolved by interpretive debate.',
      resolvedBy: 'debate',
    });
  }

  return determinations;
}

export function assembleSelection(diff: SelectionDiff, determinations: SelectionDetermination[]): SelectionAssembly {
  const determinationById = new Map(
    determinations.map((determination) => [determination.disagreementId, determination]),
  );
  const selections: FinalSelectionResult[] = [];
  const unresolved: string[] = [];
  const buildWarnings: string[] = [];

  for (const consensus of diff.consensus) {
    if (consensus.decision !== undefined) {
      selections.push({
        componentKey: consensus.componentKey,
        decision: consensus.decision,
        reason: 'All participating agents agreed.',
        source: 'consensus',
      });
      continue;
    }

    const decisionDisagreements = diff.disagreements.filter(
      ({ componentKey, field }) => componentKey === consensus.componentKey && field === 'decision',
    );
    const componentDeterminations = decisionDisagreements.map((disagreement) => determinationById.get(disagreement.id));
    if (componentDeterminations.length !== 1 || componentDeterminations[0] === undefined) {
      unresolved.push(consensus.componentKey);
      buildWarnings.push(`No complete determination exists for ${consensus.componentKey}.`);
      continue;
    }

    const determination = componentDeterminations[0];
    selections.push({
      componentKey: consensus.componentKey,
      decision: determination.decision,
      reason: determination.reason,
      source: determination.resolvedBy,
    });
  }

  const knownDisagreementIds = new Set(diff.disagreements.map(({ id }) => id));
  for (const determination of determinations) {
    if (!knownDisagreementIds.has(determination.disagreementId)) {
      buildWarnings.push(`Unused determination: ${determination.disagreementId}.`);
    }
  }

  return {
    selections,
    report: { unresolvedCount: unresolved.length, unresolved, buildWarnings },
  };
}

export interface SelectionReviewItem extends TieredSelectionDisagreement {
  status: 'pending' | 'resolved';
  determination?: SelectionDetermination;
  debate?: SelectionPipelineResult['debateTranscripts'][number];
}

export function buildSelectionReview(
  disagreements: TieredSelectionDisagreement[],
  determinations: SelectionDetermination[],
  debateTranscripts: SelectionPipelineResult['debateTranscripts'] = [],
): SelectionReviewItem[] {
  const determinationById = new Map(
    determinations.map((determination) => [determination.disagreementId, determination]),
  );
  const debateById = new Map(debateTranscripts.map((transcript) => [transcript.disagreementId, transcript]));
  return disagreements.map((disagreement) => {
    const determination = determinationById.get(disagreement.id);
    const debate = debateById.get(disagreement.id);
    return { ...disagreement, status: determination ? 'resolved' : 'pending', determination, debate };
  });
}
