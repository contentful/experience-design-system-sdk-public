import { useCallback, useEffect, useState } from 'react';
import type { ComponentTypeSummary, ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { applyPreviewAnnotations } from '../../../analyze/select/preview-annotations.js';
import type { PreviewAnnotation } from '../../../analyze/select/types.js';
import { useLivePreview, type UseLivePreviewReturn } from '../useLivePreview.js';

const SPINNER_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

export type UseReviewPreviewOptions = {
  components: ReadonlyArray<{ key: string }>;
  loading: boolean;
  livePreview: boolean;
  sessionId: string;
  tokensPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  deleteAllComponents?: boolean;
  allowDeletions?: boolean;
  onResult?: (response: ServerPreviewResponse) => void;
};

export type UseReviewPreviewResult = {
  previewAnnotations: Map<string, PreviewAnnotation>;
  removedComponents: ComponentTypeSummary[];
  livePreviewHook: UseLivePreviewReturn;
  livePreviewSpinner: string;
};

export function useReviewPreview({
  components,
  loading,
  livePreview,
  sessionId,
  tokensPath,
  spaceId,
  environmentId,
  cmaToken,
  host,
  deleteAllComponents,
  allowDeletions,
  onResult,
}: UseReviewPreviewOptions): UseReviewPreviewResult {
  const [previewAnnotations, setPreviewAnnotations] = useState<Map<string, PreviewAnnotation>>(new Map());
  const [removedComponents, setRemovedComponents] = useState<ComponentTypeSummary[]>([]);

  const handleResult = useCallback(
    (response: ServerPreviewResponse | null): void => {
      if (!response) return;
      setPreviewAnnotations(
        applyPreviewAnnotations(
          response,
          components.map((component) => component.key),
        ),
      );
      setRemovedComponents(response.components.removed ?? []);
      onResult?.(response);
    },
    [components, onResult],
  );

  const livePreviewHook = useLivePreview({
    enabled: livePreview,
    sessionId,
    tokensPath,
    spaceId,
    environmentId,
    cmaToken,
    host,
    onResult: handleResult,
    deleteAllComponents,
    allowDeletions,
  });

  const [spinnerTick, setSpinnerTick] = useState(0);
  useEffect(() => {
    if (livePreviewHook.status !== 'running') return;
    const id = setInterval(() => setSpinnerTick((tick) => tick + 1), 80);
    return () => clearInterval(id);
  }, [livePreviewHook.status]);
  const livePreviewSpinner = SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length];

  useEffect(() => {
    if (loading) return;
    if (!livePreview) return;
    if (components.length === 0) return;
    livePreviewHook.trigger();
  }, [loading]);

  return { previewAnnotations, removedComponents, livePreviewHook, livePreviewSpinner };
}
