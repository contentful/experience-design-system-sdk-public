import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const capturedContexts = new Map<string, string>();

/** Read the supplied immutable evidence while the invocation owns its artifacts. */
export function readExplorationContext(prompt: string): string {
  const captured = capturedContexts.get(prompt);
  if (captured !== undefined) return captured;
  const command = prompt.match(/through this exact read-only command:\n([^\n]+)/)?.[1];
  if (!command) return prompt;
  const args = [...command.matchAll(/'((?:'"'"'|[^'])*)'/g)].map((match) => match[1]!.replaceAll("'\"'\"'", "'"));
  if (args.length !== 3 || args[0] !== process.execPath || !args[1]!.endsWith('/read.mjs'))
    throw new Error('Unexpected exploration fixture reader command');
  const contextPath = prompt.match(/Complete immutable original task and source context: ("(?:\\.|[^"])*")\./)?.[1];
  const context = contextPath ? readFileSync(JSON.parse(contextPath) as string, 'utf8') : prompt;
  const input = execFileSync(args[0], [...args.slice(1), 'exact', ''], {
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
  const reconstructed = context.replace(/(\nInput data:\n)[^\n]+/, (_, header: string) => header + input);
  capturedContexts.set(prompt, reconstructed);
  return reconstructed;
}
