import { summarizeTokens } from '../../helpers/summarizers/summarize-tokens.js';
import type { ExistingContentfulEntities } from '../../types/existing-entities.js';
import type { SelectAgentSummary } from '../../types/summaries.js';

export interface SummarizeForSelectRequest {
  entities: ExistingContentfulEntities;
}

/** Projection for the select agent prompt: components + token counts. */
export function summarizeForSelect(request: SummarizeForSelectRequest): SelectAgentSummary {
  const { entities } = request;
  return {
    components: entities.components.map((c) => ({
      id: c.sys.id,
      name: c.name,
      description: c.description,
    })),
    tokens: summarizeTokens(entities.tokens),
  };
}
