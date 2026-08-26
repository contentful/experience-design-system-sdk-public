import React from 'react';
import { Box, Text } from 'ink';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { PALETTE } from '../theme.js';

export type TokenPropSuggestion = {
  propName: string;
  sets: string[];
  allowed: string[];
};

/**
 * Design-token props on `entry` that carry a $token.sets suggestion to review.
 * A prop with cdf_type 'token' but no $token.sets yet (map tokens hasn't run,
 * or found nothing to suggest) is excluded — there is nothing to review.
 */
export function collectTokenSuggestions(entry: CDFComponentEntry): TokenPropSuggestion[] {
  return Object.entries(entry.$properties)
    .filter(([, def]) => def.$type === 'token' && def.$category === 'design' && (def['$token.sets']?.length ?? 0) > 0)
    .map(([propName, def]) => ({
      propName,
      sets: def['$token.sets'] ?? [],
      allowed: def['$token.allowed'] ?? [],
    }));
}

export type TokenReviewDecision = 'pending' | 'accepted';

export type TokenReviewPanelProps = {
  componentName: string;
  suggestions: TokenPropSuggestion[];
  decisions: Record<string, TokenReviewDecision>;
  selectedRow: number;
  editing: boolean;
  editCursor: number;
  editSelection: Set<string>;
  width: number;
  height: number;
  active: boolean;
};

export function TokenReviewPanel(_props: TokenReviewPanelProps): React.ReactElement {
  return <Box />;
}
