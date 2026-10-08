import type { ComponentProps } from 'contentful-management';
import { findNearlyMatchingComponent } from '../../helpers/existing-entities/find-nearly-matching-component.js';
import { summarizeTokens } from '../../helpers/summarizers/summarize-tokens.js';
import type { ExistingContentfulEntities } from '../../types/existing-entities.js';
import type { GenerateAgentSummary } from '../../types/summaries.js';

type DesignProperty = ComponentProps['designProperties'][number];
type ContentProperty = ComponentProps['contentProperties'][number];
type Slot = NonNullable<ComponentProps['slots']>[number];

export interface SummarizeForGenerateRequest {
  entities: ExistingContentfulEntities;
  codebaseComponentName: string;
}

/**
 * Projection for the generate agent prompt. Picks the likely-matching
 * existing component (by name) and surfaces its props + slots in short form.
 */
export function summarizeForGenerate(request: SummarizeForGenerateRequest): GenerateAgentSummary {
  const { entities, codebaseComponentName } = request;
  const match = findNearlyMatchingComponent(entities.components, codebaseComponentName);
  const otherComponents = entities.components
    .filter((c) => c.sys.id !== match?.sys.id)
    .map((c) => ({ id: c.sys.id, name: c.name }));

  return {
    likelyMatch: match
      ? {
          id: match.sys.id,
          name: match.name,
          designProperties: match.designProperties.map((p: DesignProperty) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
          contentProperties: match.contentProperties.map((p: ContentProperty) => ({
            id: p.id,
            name: p.name,
            type: p.type,
          })),
          slots: (match.slots ?? []).map((s: Slot) => ({ id: s.id, name: s.name })),
        }
      : undefined,
    otherComponents,
    tokens: summarizeTokens(entities.tokens),
  };
}
