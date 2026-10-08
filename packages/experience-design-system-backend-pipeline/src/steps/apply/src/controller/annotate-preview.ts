import type { ServerPreviewResponse } from '../../../shared/index.js';
import { annotatePreview as impl } from '../helpers/annotate-preview.js';
import type { PreviewAnnotation } from '../types/preview-annotation.js';

export type { PreviewAnnotation };

export interface AnnotatePreviewRequest {
  preview: ServerPreviewResponse;
  localNames: readonly string[];
}

export function annotatePreview(request: AnnotatePreviewRequest): Map<string, PreviewAnnotation> {
  return impl(request.preview, request.localNames);
}
