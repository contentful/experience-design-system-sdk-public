export const COMPONENT_SCOPES = [
  'components-1',
  'components-2',
  'components-3',
  'components-4',
  'components-5',
  'components-6',
  'components-7',
] as const;
export const CANDIDATE_FREE_SCOPES = ['components-6', 'components-7'] as const;
export const DETAIL_SCOPES = ['full-inventory-1', 'full-inventory-2', 'full-inventory-3'] as const;
export const EXPLORE_SCOPES = [...COMPONENT_SCOPES, ...DETAIL_SCOPES] as const;
export const EXPLORE_MAX_ATTEMPTS = 6;
export const AGENT_CALL_MAX_ATTEMPTS = EXPLORE_MAX_ATTEMPTS;
export const SUPERMAJORITY = 0.75;
export const SLOT_THRESHOLD = 0.6;
export const ABSENT = '__absent__';
