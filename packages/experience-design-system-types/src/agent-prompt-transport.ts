export const MAX_ARGV_PROMPT_BYTES = 100_000;

const DEFAULT_STDIN_PROMPT_AGENTS = ['claude', 'codex'] as const;

export function shouldUseStdinForPrompt(agent: string, promptViaStdin?: boolean): boolean {
  return promptViaStdin ?? DEFAULT_STDIN_PROMPT_AGENTS.some((candidate) => candidate === agent);
}

export function formatArgvPromptSizeLimitError(agent: string, promptBytes: number): string {
  return `The ${agent} prompt is being sent as a command-line argument and exceeds the ${MAX_ARGV_PROMPT_BYTES}-byte safety limit (${promptBytes} UTF-8 bytes). Use claude or codex with stdin delivery for large projects.`;
}
