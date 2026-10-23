import type { ScopeComponentRow } from '@contentful/experience-design-system-backend-pipeline';

/**
 * One row of the gate. The loader always fills in the slots, but the screen is handed whatever the caller has, and
 * legacy's screen accepted rows without them (and without the AI fields), so those stay optional here.
 */
export type ScopeComponent = Omit<ScopeComponentRow, 'aiDecision' | 'aiReason' | 'needsReview' | 'slots'> & {
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
  aiReason?: string | null;
  needsReview?: boolean;
  slots?: ScopeComponentRow['slots'];
};

export type Decision = 'accepted' | 'rejected' | 'undecided';

/** What the user confirmed. Becomes `ImportHandoff.scope`; the legacy wizard saves it and starts generation. */
export interface ScopeDecisions {
  accepted: string[];
  rejected: string[];
}

export type ScopeGateLoad = { ok: true; components: ScopeComponent[] } | { ok: false; message: string };
