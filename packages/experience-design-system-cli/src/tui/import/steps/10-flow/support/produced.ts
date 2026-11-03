import type { FlowState } from '../flow/types.js';

/** What an import produced, so the screens after the work can describe what happened and not a fixed pair. */
export interface Produced {
  components: boolean;
  tokens: boolean;
}

/** Components exist when extraction ran; tokens exist when the token stage left a catalog or a session behind. */
export function producedOf(state: Pick<FlowState, 'extractSessionId' | 'tokensPath' | 'tokenSessionId'>): Produced {
  return { components: state.extractSessionId !== null, tokens: !!state.tokensPath || state.tokenSessionId !== null };
}

/**
 * How the saved file is described: the file is always named `components.json`, but when only tokens were generated it
 * holds just the tokens, and calling it a components file would mislead.
 */
export function fileSummaryLabel({ components }: Produced): string {
  return components ? 'components.json' : 'components.json (design tokens only)';
}

/** How many of each thing a run writes. A missing or zero count is left out of the wording, never shown as "0". */
export interface ProducedCounts {
  components?: number;
  tokens?: number;
}

function counted(count: number | undefined, noun: string): string {
  if (!count) return `${noun}s`;
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * "12 component types and 42 design tokens", "42 design tokens", or "component types": the things this run writes, with
 * how many of each when known.
 */
export function countedThings({ components, tokens }: Produced, counts: ProducedCounts = {}): string {
  const parts: string[] = [];
  if (components || !tokens) parts.push(counted(counts.components, 'component type'));
  if (tokens) parts.push(counted(counts.tokens, 'design token'));
  return parts.join(' and ');
}

/** "component types and design tokens", "design tokens", or "component types": the things this run writes. */
export function writtenThings(produced: Produced): string {
  return countedThings(produced);
}
