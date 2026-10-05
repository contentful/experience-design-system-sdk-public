// Agent identity
export { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName } from './generate/model/agent.js';
export type { AgentName } from './generate/model/agent.js';

// Agent invocation (low-level)
export {
  agentSupportsBedrock,
  buildArgs,
  resolveAgentModel,
  resolveBinary,
} from './generate/services/agent-configuration-service.js';
export { checkAgentAuth } from './generate/services/agent-auth-service.js';
export { describeAgentFailure } from './generate/services/failure-diagnostics-service.js';
export { runAgent } from './generate/adapters/local/local-agent-process.js';
export {
  extractSentinelOutput,
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
export { createLocalCliAgentInvoker } from './generate/adapters/local/local-agent-invoker.js';
export type { CreateLocalCliAgentInvokerOptions } from './generate/adapters/local/local-agent-invoker.js';
export type { AgentInvoker, InvokeAgentOptions } from './generate/services/ports/agent-invoker.js';

// Prompt building
export { buildPrompt, formatCustomPromptBanner } from './generate/services/prompt-service.js';
export { resolveSkillPath } from './generate/services/skill-loader.js';
export type { ComponentSourceRef, GeneratedCdf, Mode, PromptOptions, Skill } from './generate/model/prompt.js';

// Progress reporting
export { formatGenerateProgressLine } from './generate/services/progress-service.js';
export type { GenerateProgressEvent } from './generate/model/progress.js';

// Generation endpoint contract
export { createGenerateEndpoint } from './generate/controller/generate-endpoint.js';
export type {
  GenerateEndpoint,
  GenerateEndpointDependencies,
  GeneratePromptService,
  GenerateProtocolParser,
} from './generate/controller/generate-endpoint.js';
export { GenerateRequestError } from './generate/model/errors.js';
export type { GenerateRequestErrorReason } from './generate/model/errors.js';
export type {
  GenerateEndpointRequest,
  GenerateEndpointResponse,
  GeneratePreviewRequest,
  GeneratePreviewResponse,
  StageToolCalls,
} from './generate/model/endpoint.js';
