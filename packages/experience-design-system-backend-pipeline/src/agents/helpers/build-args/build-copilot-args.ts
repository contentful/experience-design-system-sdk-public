import { resolveAgentModel } from '../resolve-agent-model.js';

/**
 * copilot's -p takes the prompt as its value — it MUST come immediately
 * after -p or the CLI rejects with "Invalid command format".
 *
 * Model handling is special: copilot's UI shows "Auto" as the default pick,
 * but the CLI rejects --model Auto ("not available"). Auto is a UI-only
 * label — internally, omitting --model IS Auto. So we only pass --model when
 * the user set an explicit override (via flag or EDS_AGENT_MODEL_COPILOT);
 * the sentinel string 'Auto' means "omit".
 */
export function buildCopilotArgs(model: string | undefined, promptArg: string[]): string[] {
  const copilotModel = resolveAgentModel('copilot', model);
  const copilotModelArg = !copilotModel || copilotModel === 'Auto' ? [] : ['--model', copilotModel];
  return ['-p', ...promptArg, ...copilotModelArg, '--allow-all-tools'];
}
