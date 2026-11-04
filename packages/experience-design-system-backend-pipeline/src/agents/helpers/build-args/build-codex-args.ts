import { codexBedrockConfigArgs } from '../bedrock/codex-bedrock-config-args.js';

export function buildCodexArgs(
  modelArg: string[],
  promptArg: string[],
  bedrock: boolean,
  conversation?: { id?: string },
): string[] {
  const bedrockArgs = bedrock ? codexBedrockConfigArgs() : [];
  return [
    'exec',
    ...(conversation?.id ? ['resume'] : []),
    ...bedrockArgs,
    ...modelArg,
    '--dangerously-bypass-approvals-and-sandbox',
    ...(conversation ? ['--json'] : []),
    ...(conversation?.id ? [conversation.id] : []),
    ...(conversation && !promptArg.length ? ['-'] : promptArg),
  ];
}
