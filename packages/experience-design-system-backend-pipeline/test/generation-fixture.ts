import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const capturedContexts = new Map<string, string>();

/** Capture immutable context during invocation, before its normal cleanup. */
export function readGenerationContext(prompt: string): string {
  const path = prompt.match(/^Complete original context artifact: (.+)$/m)?.[1];
  if (!path) return prompt;
  const captured = capturedContexts.get(prompt);
  if (captured !== undefined) return captured;
  const context = readFileSync(JSON.parse(path) as string, 'utf8');
  capturedContexts.set(prompt, context);
  return context;
}

/** Exercise the supplied validator; never manufacture a receipt or bypass host admission. */
export function preflightGenerationResult<T extends { stdout: string; exitCode: number; timedOut?: boolean }>(
  prompt: string,
  result: T,
  honorAttemptSubjects = false,
): T {
  readGenerationContext(prompt);
  if (result.exitCode !== 0 || result.timedOut) return result;
  const command = prompt.match(/## Mandatory exact-output preflight\n[^\n]+\n([^\n]+)/)?.[1];
  if (!command) return result;
  const args = [...command.matchAll(/'((?:'"'"'|[^'])*)'/g)].map((match) => match[1]!.replaceAll("'\"'\"'", "'"));
  if (args.length !== 5 || args[0] !== process.execPath || !args[1]!.endsWith('/validate-representation-draft.js'))
    throw new Error('Unexpected generation fixture validator command');
  if (honorAttemptSubjects) {
    const state = JSON.parse(readFileSync(args[3]!, 'utf8')) as {
      acceptedDecisions: Array<{ tool: string; prop?: string; slot?: string }>;
      pendingSubjects: string[];
    };
    const subject = (call: { tool: string; prop?: string; slot?: string }) =>
      call.prop !== undefined ? `property:${call.prop}` : call.slot !== undefined ? `slot:${call.slot}` : 'component';
    const accepted = new Set(state.acceptedDecisions.map(subject));
    result = {
      ...result,
      stdout: result.stdout
        .split('\n')
        .filter((line) => {
          if (!line) return false;
          const key = subject(JSON.parse(line));
          return !accepted.has(key) || state.pendingSubjects.includes(key);
        })
        .join('\n'),
    };
  }
  execFileSync(args[0], args.slice(1), { input: result.stdout, encoding: 'utf8', timeout: 10000 });
  return result;
}
