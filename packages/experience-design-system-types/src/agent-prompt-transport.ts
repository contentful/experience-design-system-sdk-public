const DEFAULT_STDIN_PROMPT_AGENTS = ['claude', 'codex'] as const;

export function shouldUseStdinForPrompt(agent: string, promptViaStdin?: boolean): boolean {
  return promptViaStdin ?? DEFAULT_STDIN_PROMPT_AGENTS.some((candidate) => candidate === agent);
}
