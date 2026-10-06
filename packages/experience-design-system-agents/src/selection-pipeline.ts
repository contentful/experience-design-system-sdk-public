import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import {
  diffSelectionResults,
  tierSelectionDisagreements,
  type SelectionDiff,
  type SelectionDecision,
  type SelectionResult,
  type TieredSelectionDisagreement,
} from './selection-diff.js';

export type SelectionPipelineComponent = RawComponentDefinition;

export interface FactualResolution {
  disagreementId: string;
  decision?: SelectionDecision;
  reason?: string;
  [key: string]: unknown;
}

interface DebatePosition {
  role: 'for' | 'against';
  disagreementId: string;
  argument: string;
  evidence?: Array<{ source: string; line: string; quote: string }>;
}

export interface DebateTranscript {
  disagreementId: string;
  decision?: SelectionDecision;
  reason?: string;
  for?: DebatePosition;
  against?: DebatePosition;
  [key: string]: unknown;
}

export interface SelectionPipelineOptions {
  components: SelectionPipelineComponent[];
  agentCount: number;
  broadcast: (component: SelectionPipelineComponent, agentIndex: number) => Promise<SelectionResult>;
  verifyFactual: (
    disagreement: TieredSelectionDisagreement,
    component: SelectionPipelineComponent,
  ) => Promise<FactualResolution>;
  debateInterpretive: (
    disagreement: TieredSelectionDisagreement,
    component: SelectionPipelineComponent,
  ) => Promise<DebateTranscript>;
}

export interface SelectionPipelineResult {
  broadcast: SelectionResult[][];
  diff: SelectionDiff;
  tieredDisagreements: TieredSelectionDisagreement[];
  factualResolutions: FactualResolution[];
  debateTranscripts: DebateTranscript[];
}

export async function runSelectionPipeline(options: SelectionPipelineOptions): Promise<SelectionPipelineResult> {
  if (!Number.isInteger(options.agentCount) || options.agentCount < 1) {
    throw new RangeError('agentCount must be a positive integer');
  }

  const broadcast = await Promise.all(
    Array.from({ length: options.agentCount }, (_, agentIndex) =>
      Promise.all(options.components.map((component) => options.broadcast(component, agentIndex))),
    ),
  );
  const diff = diffSelectionResults(broadcast);
  const tieredDisagreements = tierSelectionDisagreements(diff.disagreements);
  const componentByKey = new Map(
    options.components.map((component) => [`${component.name}::${component.source}`, component]),
  );

  const escalations = await Promise.all(
    tieredDisagreements.map(async (disagreement) => {
      const component = componentByKey.get(disagreement.componentKey);
      if (!component)
        throw new Error(`Selection disagreement references unknown component: ${disagreement.componentKey}`);

      if (disagreement.tier === 'factual') {
        return { tier: disagreement.tier, value: await options.verifyFactual(disagreement, component) };
      }
      return { tier: disagreement.tier, value: await options.debateInterpretive(disagreement, component) };
    }),
  );

  const factualResolutions = escalations
    .filter((escalation): escalation is { tier: 'factual'; value: FactualResolution } => escalation.tier === 'factual')
    .map((escalation) => escalation.value);
  const debateTranscripts = escalations
    .filter(
      (escalation): escalation is { tier: 'interpretive'; value: DebateTranscript } =>
        escalation.tier === 'interpretive',
    )
    .map((escalation) => escalation.value);

  return { broadcast, diff, tieredDisagreements, factualResolutions, debateTranscripts };
}
