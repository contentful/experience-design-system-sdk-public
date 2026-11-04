import { loadRendererReference } from './load-renderer-reference.js';
import { summarizeForSelect } from '../../../steps/generation/src/controller/existing-entities/summarize-for-select.js';
import type { ExistingContentfulEntities } from '../../../steps/generation/src/types/existing-entities.js';
import { throwIfAborted } from '../../../helpers/abort.js';

export interface ExistingExplorationContext {
  status: 'absent' | 'available' | 'unavailable' | 'omitted';
  reason?: string;
  existingComponentsInline?: string;
  existingTokensInline?: string;
}
/** Optional prior choices are observations, not source declarations. */
export async function loadExistingExplorationContext(
  path: string | null | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<ExistingExplorationContext> {
  throwIfAborted(options.signal);
  if (!path) return { status: 'absent' };
  try {
    const input = await loadRendererReference({ kind: 'path', path }, { signal: options.signal });
    const entities = JSON.parse(input.text) as ExistingContentfulEntities;
    if (!Array.isArray(entities.components) || !Array.isArray(entities.tokens))
      throw new Error('Invalid optional context');
    const summary = summarizeForSelect({ entities });
    const existingComponentsInline = JSON.stringify(summary.components),
      existingTokensInline = JSON.stringify(summary.tokens);
    return { status: 'available', existingComponentsInline, existingTokensInline };
  } catch {
    throwIfAborted(options.signal);
    return { status: 'unavailable', reason: 'Optional existing context could not be read or parsed.' };
  }
}
