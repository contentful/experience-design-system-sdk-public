import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

export type PushExpected = {
  componentTypes: { create: number; update: number; remove: number };
  designTokens: { create: number; update: number; remove: number };
};

export type PushProgress =
  | { kind: 'queued'; operationId: string }
  | { kind: 'progress'; processed: number; total: number; current: string | null }
  | null;

export function computePushExpected(preview: ServerPreviewResponse): PushExpected {
  return {
    componentTypes: {
      create: preview.components?.new?.length ?? 0,
      update: preview.components?.changed?.length ?? 0,
      remove: preview.components?.removed?.length ?? 0,
    },
    designTokens: {
      create: preview.tokens?.new?.length ?? 0,
      update: preview.tokens?.changed?.length ?? 0,
      remove: preview.tokens?.removed?.length ?? 0,
    },
  };
}
