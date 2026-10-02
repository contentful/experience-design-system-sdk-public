import type { AgentInvocationOptions, AgentRunResult } from './invocation.js';
import type {
  MapTokenPropCall,
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
  SelectToolCall,
  TokenToolCall,
  ToolCall,
} from './protocol.js';
import type { PromptOptions } from './prompt.js';

type StagePrompt<Stage extends PromptOptions['skill']> = PromptOptions & { skill: Stage };

export type GenerateEndpointRequest =
  | { stage: 'components'; prompt: StagePrompt<'components'>; invocation: AgentInvocationOptions }
  | { stage: 'tokens'; prompt: StagePrompt<'tokens'>; invocation: AgentInvocationOptions }
  | { stage: 'select'; prompt: StagePrompt<'select'>; invocation: AgentInvocationOptions }
  | { stage: 'map-tokens'; prompt: StagePrompt<'map-tokens'>; invocation: AgentInvocationOptions };

export type GenerateEndpointResponse =
  | { stage: 'components'; run: AgentRunResult; calls: ToolCall[]; warnings: ParsedToolCalls['warnings'] }
  | { stage: 'tokens'; run: AgentRunResult; calls: TokenToolCall[]; warnings: ParsedTokenToolCalls['warnings'] }
  | { stage: 'select'; run: AgentRunResult; calls: SelectToolCall[]; warnings: ParsedSelectToolCalls['warnings'] }
  | {
      stage: 'map-tokens';
      run: AgentRunResult;
      calls: MapTokenPropCall[];
      warnings: ParsedMapTokenPropToolCalls['warnings'];
    };
