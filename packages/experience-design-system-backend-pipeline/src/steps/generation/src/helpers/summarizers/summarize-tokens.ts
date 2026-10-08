import type { DesignTokenProps } from 'contentful-management';

/** Collapse a token list into `{ count, kinds }`. */
export function summarizeTokens(tokens: DesignTokenProps[]): { count: number; kinds: string[] } {
  const kinds = new Set<string>();
  for (const t of tokens) kinds.add(t.type);
  return { count: tokens.length, kinds: [...kinds].sort() };
}
