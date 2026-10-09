import type { ExistingContentfulEntities } from '../../types/existing-entities.js';
import type { MapTokensSummary } from '../../types/summaries.js';

export interface SummarizeForMapTokensRequest {
  entities: ExistingContentfulEntities;
}

/** Projection for the map-tokens agent prompt: just the token list. */
export function summarizeForMapTokens(request: SummarizeForMapTokensRequest): MapTokensSummary {
  return {
    tokens: request.entities.tokens.map((t) => ({ id: t.sys.id, name: t.name, type: t.type })),
  };
}
