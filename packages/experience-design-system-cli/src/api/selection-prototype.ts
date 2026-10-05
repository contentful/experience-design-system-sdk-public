import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { AgentInvoker, AgentName } from '@contentful/experience-design-system-generation';
import {
  assembleSelection,
  buildSelectionReview,
  createSelectionAgentDispatcher,
  createSelectionDebateDispatcher,
  determineSelection,
  runSelectionPipeline,
  type DebateTranscript,
  type FactualResolution,
  type SelectionAgentDispatcherOptions,
  type SelectionAssembly,
  type SelectionDetermination,
  type SelectionPipelineResult,
  type SelectionReviewItem,
} from '@contentful/experience-design-system-agents';
import type { TieredSelectionDisagreement } from '@contentful/experience-design-system-agents';
import { archiveSelectionRun, type SelectionRunArchiveOptions, type SelectionRunArchiveResult } from './run-archive.js';

export interface SelectionPrototypeOptions extends Omit<SelectionAgentDispatcherOptions, 'invoker' | 'agent'> {
  invoker: AgentInvoker;
  agent: AgentName;
  agentCount: number;
  components: RawComponentDefinition[];
  verifyFactual: (
    disagreement: TieredSelectionDisagreement,
    component: RawComponentDefinition,
  ) => Promise<FactualResolution>;
  debateInterpretive?: (
    disagreement: TieredSelectionDisagreement,
    component: RawComponentDefinition,
  ) => Promise<DebateTranscript>;
  archive?: SelectionRunArchiveOptions;
}

export interface SelectionPrototypeResult {
  pipeline: SelectionPipelineResult;
  determinations: SelectionDetermination[];
  assembly: SelectionAssembly;
  review: SelectionReviewItem[];
  archive: SelectionRunArchiveResult;
}

export async function runSelectionPrototype(options: SelectionPrototypeOptions): Promise<SelectionPrototypeResult> {
  const startedAt = new Date();
  const dispatch = createSelectionAgentDispatcher(options);
  const debate = options.debateInterpretive ?? createSelectionDebateDispatcher(options);
  const pipeline = await runSelectionPipeline({
    components: options.components,
    agentCount: options.agentCount,
    broadcast: dispatch,
    verifyFactual: options.verifyFactual,
    debateInterpretive: debate,
  });
  const determinations = determineSelection(pipeline);
  const assembly = assembleSelection(pipeline.diff, determinations);
  const review = buildSelectionReview(pipeline.tieredDisagreements, determinations, pipeline.debateTranscripts);
  const archive = await archiveSelectionRun({
    ...options.archive,
    components: options.components,
    agentCount: options.agentCount,
    pipeline,
    determinations,
    assembly,
    review,
    startedAt,
    completedAt: new Date(),
  });

  return { pipeline, determinations, assembly, review, archive };
}
