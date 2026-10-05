import type { AgentInvocationOptions, AgentRunResult } from './invocation.js';
import type { MapTokenPropCall, SelectToolCall, TokenToolCall, ToolCall } from './protocol.js';
import type { PromptOptions, Skill } from './prompt.js';

/** The tool calls each generation stage's agent is allowed to emit. */
export interface StageToolCalls {
  components: ToolCall;
  tokens: TokenToolCall;
  select: SelectToolCall;
  'map-tokens': MapTokenPropCall;
}

/** A request for one generation attempt. The stage is the prompt's skill, so the two cannot disagree. */
export interface GenerateEndpointRequest<Stage extends Skill = Skill> {
  prompt: PromptOptions & { skill: Stage };
  invocation: AgentInvocationOptions;
}

export type GeneratePreviewRequest<Stage extends Skill = Skill> = Pick<GenerateEndpointRequest<Stage>, 'prompt'>;

export interface GenerateEndpointResponse<Stage extends Skill = Skill> {
  stage: Stage;
  prompt: string;
  run: AgentRunResult;
  calls: Array<StageToolCalls[Stage]>;
  warnings: string[];
  failure?: string;
}

export interface GeneratePreviewResponse<Stage extends Skill = Skill> {
  stage: Stage;
  prompt: string;
}
