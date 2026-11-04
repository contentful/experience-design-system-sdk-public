// --- Types ---
export * from './types/index.js';

// --- Constants ---

// --- Agent capability + resolution helpers ---
export { isAgentName } from './helpers/resolution/is-agent-name.js';

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

// Legacy-name alias used by cli-legacy map-tokens command

// --- Services (subprocess transport) ---
export { runAgent } from './services/run-agent.js';

export { invokeAgentWithOutput, type InvokeAgentWithOutputResult } from './services/invoke-agent-with-output.js';

// --- Output formatter (streaming agent stdout → human-readable lines) ---
export { OutputFormatter, formatToolCall } from './output-formatter/index.js';

// --- Invoker (AgentInvoker interface implementations) ---
export { createLocalCliAgentInvoker } from './invoker/create-local-cli-agent-invoker.js';

// --- Prompt building ---
export { buildPrompt } from './prompts/build-prompt.js';

export { resolveSkillPath } from './prompts/resolve-skill-path.js';
