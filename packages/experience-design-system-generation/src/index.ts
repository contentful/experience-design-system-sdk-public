// Agent identity
export { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName } from './generate/model/agent.js';
export type { AgentName } from './generate/model/agent.js';

// Agent invocation (low-level)
export {
  agentSupportsBedrock,
  buildArgs,
  checkAgentAuth,
  describeAgentFailure,
  extractSentinelOutput,
  resolveAgentModel,
  resolveBinary,
  runAgent,
} from './agent-runner.js';
export {
  parseMapTokenPropToolCallLines,
  parseSelectToolCallLines,
  parseTokenToolCallLines,
  parseToolCallLines,
} from './generate/services/protocol-parser-service.js';
export type {
  AgentAuthStatus,
  AgentDebugEvent,
  AgentInvocationOptions,
  AgentRunResult,
} from './generate/model/invocation.js';
export type {
  ClassifyComponentCall,
  ClassifyPropCall,
  ClassifySlotCall,
  ExcludePropCall,
  MapTokenPropCall,
  ParsedMapTokenPropToolCalls,
  ParsedSelectToolCalls,
  ParsedTokenToolCalls,
  ParsedToolCalls,
  RejectComponentCall,
  SelectComponentCall,
  SelectToolCall,
  SetGroupCall,
  SetTokenCall,
  ToolCall,
  TokenToolCall,
} from './generate/model/protocol.js';

// Agent invocation (interface)
export { createLocalCliAgentInvoker } from './agent-invoker.js';
export type { CreateLocalCliAgentInvokerOptions } from './agent-invoker.js';
export type { AgentInvoker, InvokeAgentOptions } from './generate/services/ports/agent-invoker.js';

// Prompt building
export { buildPrompt, formatCustomPromptBanner, resolveSkillPath } from './prompt-builder.js';
export type { ComponentSourceRef, GeneratedCdf, Mode, PromptOptions, Skill } from './generate/model/prompt.js';

// Progress reporting
export { formatGenerateProgressLine } from './progress.js';
export type { GenerateProgressEvent } from './generate/model/progress.js';

// Generation endpoint contract
export type { GenerateEndpointRequest, GenerateEndpointResponse } from './generate/model/endpoint.js';
