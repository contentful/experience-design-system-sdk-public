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
  | { stage: 'components'; prompt: StagePrompt<'components'>; invocation: AgentInvocationOptions; dryRun?: boolean }
  | { stage: 'tokens'; prompt: StagePrompt<'tokens'>; invocation: AgentInvocationOptions; dryRun?: boolean }
  | { stage: 'select'; prompt: StagePrompt<'select'>; invocation: AgentInvocationOptions; dryRun?: boolean }
  | { stage: 'map-tokens'; prompt: StagePrompt<'map-tokens'>; invocation: AgentInvocationOptions; dryRun?: boolean };

type GenerateEndpointRunResponse =
  | {
      stage: 'components';
      dryRun: false;
      prompt: string;
      run: AgentRunResult;
      calls: ToolCall[];
      warnings: ParsedToolCalls['warnings'];
      failure?: string;
    }
  | {
      stage: 'tokens';
      dryRun: false;
      prompt: string;
      run: AgentRunResult;
      calls: TokenToolCall[];
      warnings: ParsedTokenToolCalls['warnings'];
      failure?: string;
    }
  | {
      stage: 'select';
      dryRun: false;
      prompt: string;
      run: AgentRunResult;
      calls: SelectToolCall[];
      warnings: ParsedSelectToolCalls['warnings'];
      failure?: string;
    }
  | {
      stage: 'map-tokens';
      dryRun: false;
      prompt: string;
      run: AgentRunResult;
      calls: MapTokenPropCall[];
      warnings: ParsedMapTokenPropToolCalls['warnings'];
      failure?: string;
    };

type GenerateEndpointPromptResponse =
  | { stage: 'components'; dryRun: true; prompt: string }
  | { stage: 'tokens'; dryRun: true; prompt: string }
  | { stage: 'select'; dryRun: true; prompt: string }
  | { stage: 'map-tokens'; dryRun: true; prompt: string };

export type GenerateEndpointResponse = GenerateEndpointRunResponse | GenerateEndpointPromptResponse;
