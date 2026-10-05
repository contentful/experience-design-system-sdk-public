// Agent identity
export { AGENT_NAMES, AGENT_BINARIES, DEFAULT_AGENT_NAME, isAgentName } from './agent-names.js';
export type { AgentName } from './agent-names.js';

// Agent types
export type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from './types/agent.js';

// Tool call types
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
  SelectionSlotEvidence,
  SelectionSlotEvidenceCitation,
  SetGroupCall,
  SetTokenCall,
  ToolCall,
  TokenToolCall,
} from './types/tool-calls.js';

// Prompt types
export type { ComponentSourceRef, DebateRole, GeneratedCdf, Mode, PromptOptions, Skill } from './types/prompt.js';

// Generation endpoint (primary entry point)
export { createGenerationEndpoint } from './controller/create-generation-endpoint.js';
export type {
  GenerationEndpoint,
  GenerationEndpointOptions,
  GenerationEndpointRequest,
  GenerationEndpointResponse,
} from './controller/create-generation-endpoint.js';

// Orchestrator (lower-level — for callers that supply their own invoker)
export { executeGenerationOrchestrator } from './orchestrator/execute-generation-orchestrator.js';
export type { GenerationOrchestratorRequest } from './orchestrator/execute-generation-orchestrator.js';

// Agent execution (low-level)
export {
  agentSupportsBedrock,
  buildAgentArgs as buildArgs,
  resolveAgentModel,
} from './services/agent/helpers/build-agent-args.js';
export { resolveAgentBinary as resolveBinary } from './services/agent/helpers/resolve-agent-binary.js';
export { checkAgentAuth } from './services/agent/helpers/check-agent-auth.js';
export { runAgent, describeAgentFailure, extractSentinelOutput } from './services/agent/run-agent.js';

// Tool call parsing
export { parsePropToolCallLines as parseToolCallLines } from './services/parsing/parse-prop-tool-calls.js';
export { parseSelectToolCallLines } from './services/parsing/parse-select-tool-calls.js';
export { parseTokenToolCallLines } from './services/parsing/parse-token-tool-calls.js';
export { parseMapTokenPropToolCallLines } from './services/parsing/parse-map-token-tool-calls.js';

// Prompt building
export { buildPrompt, formatCustomPromptBanner, resolveSkillPath } from './services/prompts/build-prompt.js';

// Progress reporting
export { formatGenerateProgressLine } from './progress.js';

// Backward-compat exports — CLI callers still use these; migrate to createGenerationEndpoint
export { createLocalCliAgentInvoker } from './services/agent/local-cli-agent-invoker.js';
export type {
  AgentInvoker,
  InvokeAgentOptions,
  LocalCliAgentInvokerOptions as CreateLocalCliAgentInvokerOptions,
} from './types/invoker.js';
