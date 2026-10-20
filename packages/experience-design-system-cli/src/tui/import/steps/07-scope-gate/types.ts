import type {
  ScopeComponentRow,
  ScopeDecisions,
  ScopeDecisionProvenance,
} from '@contentful/experience-design-system-backend-pipeline';

export type { ScopeDecisions };

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

export type ScopeProvenance = ScopeDecisionProvenance;

export type ScopeGateLoad =
  | { ok: true; components: ScopeComponent[]; savedDecisions?: ScopeDecisions }
  | { ok: false; message: string };
