import type { CdfReviewEntry } from '../types.js';

export function describeAcceptedGenerationErrors(
  components: readonly Pick<CdfReviewEntry, 'key' | 'status' | 'generationError'>[],
): string | null {
  const failing = components.filter((component) => component.status === 'accepted' && component.generationError);
  if (failing.length === 0) return null;
  const details = failing
    .map((component) => `${component.key}: ${component.generationError!.replace(/\s+/g, ' ').trim()}`)
    .join('; ');
  return `Cannot finalize — accepted ${failing.length === 1 ? 'component has' : 'components have'} an invalid definition (${details}). Fix or reject ${failing.length === 1 ? 'it' : 'them'}.`;
}
