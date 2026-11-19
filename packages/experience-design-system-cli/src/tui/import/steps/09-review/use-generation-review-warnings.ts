import { useEffect, useState } from 'react';
import { refreshGeneratedReviewWarnings } from '@contentful/experience-design-system-backend-pipeline';
import type { CdfReviewEntry } from './types.js';

export function useGenerationReviewWarnings(
  sessionId: string,
  components: CdfReviewEntry[],
  setComponents: (components: CdfReviewEntry[]) => void,
  loading: boolean,
  loadError: string | null,
): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (loading || loadError) return;
    try {
      const next = refreshGeneratedReviewWarnings(sessionId, components);
      if (next.some((component, index) => component.generationError !== components[index]?.generationError)) {
        setComponents(next);
      }
      setError(null);
    } catch {
      setError('Warning validation is unavailable; existing warnings preserved.');
    }
  }, [components, sessionId, loading, loadError, setComponents]);
  return error;
}
