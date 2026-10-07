import { codexBedrockConfigArgs } from '../codex-bedrock-config-args.js';

export function buildCodexArgs(modelArg: string[], promptArg: string[], bedrock: boolean): string[] {
  const bedrockArgs = bedrock ? codexBedrockConfigArgs() : [];
  return ['exec', ...bedrockArgs, ...modelArg, '--dangerously-bypass-approvals-and-sandbox', ...promptArg];
}
