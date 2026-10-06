import { sameValue } from './value-equality.js';
export type SelectionDecision = 'accepted' | 'rejected';
type DisagreementTier = 'factual' | 'interpretive';

export interface SelectionResult {
  componentKey: string;
  decision: SelectionDecision;
  reason: string;
  facts?: Record<string, unknown>;
}

interface SelectionConsensus {
  componentKey: string;
  decision?: SelectionDecision;
  reason: string;
  facts?: Record<string, unknown>;
  coverage: number;
  providers: number[];
}

export interface SelectionDisagreement {
  id: string;
  componentKey: string;
  field: string;
  valuesByAgent: Record<number, unknown>;
  reasonsByAgent: Record<number, string>;
}

export interface TieredSelectionDisagreement extends SelectionDisagreement {
  tier: DisagreementTier;
  tierReason: string;
}

export interface SelectionDiff {
  consensus: SelectionConsensus[];
  disagreements: SelectionDisagreement[];
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function diffSelectionResults(agentResults: SelectionResult[][]): SelectionDiff {
  const byComponent = new Map<string, Map<number, SelectionResult>>();

  agentResults.forEach((results, agentIndex) => {
    results.forEach((result) => {
      const byAgent = byComponent.get(result.componentKey) ?? new Map<number, SelectionResult>();
      byAgent.set(agentIndex, result);
      byComponent.set(result.componentKey, byAgent);
    });
  });

  const consensus: SelectionConsensus[] = [];
  const disagreements: SelectionDisagreement[] = [];
  let nextDisagreementId = 1;

  for (const componentKey of [...byComponent.keys()].sort()) {
    const byAgent = byComponent.get(componentKey)!;
    const entries = [...byAgent.entries()].sort(([left], [right]) => left - right);
    const componentConsensus: SelectionConsensus = {
      componentKey,
      reason: entries[0]![1].reason,
      coverage: entries.length,
      providers: entries.map(([agentIndex]) => agentIndex),
    };

    const decisions = entries.map(([, result]) => result.decision);
    if (decisions.every((decision) => sameValue(decision, decisions[0]))) {
      componentConsensus.decision = decisions[0];
    } else {
      disagreements.push({
        id: `d${nextDisagreementId++}`,
        componentKey,
        field: 'decision',
        valuesByAgent: Object.fromEntries(
          entries.map(([agentIndex, result]) => [agentIndex, cloneValue(result.decision)]),
        ),
        reasonsByAgent: Object.fromEntries(entries.map(([agentIndex, result]) => [agentIndex, result.reason])),
      });
    }

    const factNames = new Set(entries.flatMap(([, result]) => Object.keys(result.facts ?? {})));
    const consensusFacts: Record<string, unknown> = {};
    for (const field of [...factNames].sort()) {
      const factEntries = entries
        .map(([agentIndex, result]) => [agentIndex, result] as const)
        .filter(([, result]) => result.facts?.[field] !== undefined);
      const values = factEntries.map(([, result]) => result.facts![field]);
      if (values.length === 0) continue;
      if (values.length === 1 || values.every((value) => sameValue(value, values[0]))) {
        consensusFacts[field] = cloneValue(values[0]);
        continue;
      }

      disagreements.push({
        id: `d${nextDisagreementId++}`,
        componentKey,
        field,
        valuesByAgent: Object.fromEntries(
          factEntries.map(([agentIndex, result]) => [agentIndex, cloneValue(result.facts![field])]),
        ),
        reasonsByAgent: Object.fromEntries(factEntries.map(([agentIndex, result]) => [agentIndex, result.reason])),
      });
    }

    if (Object.keys(consensusFacts).length > 0) componentConsensus.facts = consensusFacts;

    consensus.push(componentConsensus);
  }

  return { consensus, disagreements };
}

const FACTUAL_FIELDS = new Set([
  'description',
  '$description',
  'type',
  '$type',
  'values',
  '$values',
  'tokenKind',
  '$tokenKind',
  'tokenPaths',
  '$tokenPaths',
  'required',
  '$required',
  'default',
  '$default',
]);

export function tierSelectionDisagreements(disagreements: SelectionDisagreement[]): TieredSelectionDisagreement[] {
  return disagreements.map((disagreement) => {
    const tier = FACTUAL_FIELDS.has(disagreement.field) ? 'factual' : 'interpretive';
    return {
      ...disagreement,
      tier,
      tierReason:
        tier === 'factual'
          ? 'The field is directly verifiable from source or extracted metadata.'
          : 'The field requires judgment about whether the component belongs in the authoring surface.',
    };
  });
}
