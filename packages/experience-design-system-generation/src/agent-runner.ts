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
  parseMapTokenPropToolCallLines,
  parseSelectToolCallLines,
  parseTokenToolCallLines,
  parseToolCallLines,
} from './generate/services/protocol-parser-service.js';

export { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName } from './generate/model/agent.js';
export type { AgentName } from './generate/model/agent.js';
export type { AgentAuthStatus, AgentDebugEvent, AgentRunResult } from './generate/model/invocation.js';
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
  TokenToolCall,
  ToolCall,
} from './generate/model/protocol.js';

export function extractSentinelOutput(stdout: string): string | null | 'multiple' {
  const START = '<<<EDS_OUTPUT_START>>>';
  const END = '<<<EDS_OUTPUT_END>>>';

  const startIdx = stdout.indexOf(START);
  const endIdx = stdout.indexOf(END);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;

  const secondStart = stdout.indexOf(START, startIdx + START.length);
  if (secondStart !== -1 && secondStart < endIdx) return 'multiple';

  const afterStart = stdout.indexOf(END, startIdx);
  const secondEnd = stdout.indexOf(END, afterStart + END.length);
  if (secondEnd !== -1) return 'multiple';

  return stdout.slice(startIdx + START.length, endIdx).trim();
}
