import { DEFAULT_AGENT_NAME } from '../../../agents/constants/models.js';
import { isAgentName } from '../../../agents/helpers/resolution/is-agent-name.js';
import type { AgentName } from '../../../agents/types/agent-name.js';

/** Resolve which coding-agent runs mapping resolution: explicit flag > env > default. */
export function resolveCompositionAgentName(flagValue?: string): AgentName {
  if (flagValue && isAgentName(flagValue)) return flagValue;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && isAgentName(env)) return env;
  return DEFAULT_AGENT_NAME;
}
