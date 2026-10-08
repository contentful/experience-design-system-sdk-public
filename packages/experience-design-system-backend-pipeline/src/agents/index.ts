// --- Types ---
export * from './types/index.js';

// --- Constants ---
export { DEFAULT_AGENT_NAME } from './constants/models.js';

// --- Agent capability + resolution helpers ---
export { isAgentName } from './helpers/resolution/is-agent-name.js';
export { resolveBinary } from './helpers/resolution/resolve-binary.js';
export { resolveAgentModel } from './helpers/resolution/resolve-agent-model.js';
export { agentSupportsBedrock } from './helpers/bedrock/agent-supports-bedrock.js';
export { buildArgs } from './helpers/build-agent-args.js';
export { describeAgentFailure } from './helpers/metadata/describe-agent-failure.js';
export { extractSentinelOutput } from './helpers/metadata/extract-sentinel-output.js';
export { formatGenerateProgressLine } from './helpers/metadata/format-generate-progress-line.js';
export { parseAgentModel, type ParsedAgentModel } from './helpers/resolution/parse-agent-model.js';
export { resolveAgent } from './helpers/resolution/resolve-agent.js';
export { resolveModel } from './helpers/resolution/resolve-model.js';
export { looksLikePath } from './helpers/prompt-overrides/looks-like-path.js';
export {
  parsePromptOverrides,
  type PromptOverride,
  type ParsePromptOverridesResult,
} from './helpers/prompt-overrides/parse-prompt-overrides.js';
export { resolvePromptOverride } from './helpers/prompt-overrides/resolve-prompt-override.js';
export { buildUserAgent } from './helpers/metadata/build-user-agent.js';

// --- Parsers (agent stdout → structured tool calls) ---
export { parseSelectToolCalls } from './parsers/parse-select-tool-calls.js';
export { parseToolCalls } from './parsers/parse-tool-calls.js';
export { parseTokenToolCalls } from './parsers/parse-token-tool-calls.js';
export { parseMapTokenPropToolCalls } from './parsers/parse-map-token-prop-tool-calls.js';
// Legacy-name alias used by cli-legacy map-tokens command
export { parseMapTokenPropToolCalls as parseMapTokenPropToolCallLines } from './parsers/parse-map-token-prop-tool-calls.js';

// --- Services (subprocess transport) ---
export { runAgent } from './services/run-agent.js';
export type { RunAgentOptions } from './services/run-agent.js';
export { checkAgentAuth } from './services/check-agent-auth.js';
export { invokeAgentWithOutput, type InvokeAgentWithOutputResult } from './services/invoke-agent-with-output.js';

// --- Output formatter (streaming agent stdout → human-readable lines) ---
export { OutputFormatter, formatToolCall } from './output-formatter/index.js';

// --- Invoker (AgentInvoker interface implementations) ---
export { createLocalCliAgentInvoker } from './invoker/create-local-cli-agent-invoker.js';

// --- Prompt building ---
export { buildPrompt } from './prompts/build-prompt.js';
export { resolveSkillPath } from './prompts/resolve-skill-path.js';
export { formatCustomPromptBanner } from './prompts/format-custom-prompt-banner.js';
