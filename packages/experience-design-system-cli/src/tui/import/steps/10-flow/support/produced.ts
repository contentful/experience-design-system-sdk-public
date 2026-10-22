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

/** "component types and design tokens", "design tokens", or "component types": the things this run writes. */
export function writtenThings({ components, tokens }: Produced): string {
  if (components && tokens) return 'component types and design tokens';
  return tokens ? 'design tokens' : 'component types';
}
