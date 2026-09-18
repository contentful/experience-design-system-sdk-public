import type { ComponentProps, DesignTokenProps } from 'contentful-management';
import type { ExistingContentfulEntities } from './fetch-existing-contentful-entities.js';
import { findNearlyMatchingComponent } from './find-nearly-matching-component.js';

type DesignProperty = ComponentProps['designProperties'][number];
type ContentProperty = ComponentProps['contentProperties'][number];
type Slot = NonNullable<ComponentProps['slots']>[number];

export interface SelectAgentSummary {
  components: Array<{ id: string; name: string; description: string }>;
  tokens: { count: number; kinds: string[] };
}

export interface GenerateAgentSummary {
  likelyMatch?: {
    id: string;
    name: string;
    designProperties: Array<{ id: string; name: string; type: string }>;
    contentProperties: Array<{ id: string; name: string; type: string }>;
    slots: Array<{ id: string; name: string }>;
  };
  otherComponents: Array<{ id: string; name: string }>;
  tokens: { count: number; kinds: string[] };
}

export interface MapTokensSummary {
  tokens: Array<{ id: string; name: string; type: string }>;
}

export function summarizeForSelectAgent(entities: ExistingContentfulEntities): SelectAgentSummary {
  return {
    components: entities.components.map((c) => ({
      id: c.sys.id,
      name: c.name,
      description: c.description,
    })),
    tokens: summarizeTokens(entities.tokens),
  };
}

export function summarizeForGenerateAgent(
  entities: ExistingContentfulEntities,
  codebaseComponentName: string,
): GenerateAgentSummary {
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

export function summarizeForMapTokens(entities: ExistingContentfulEntities): MapTokensSummary {
  return {
    tokens: entities.tokens.map((t) => ({ id: t.sys.id, name: t.name, type: t.type })),
  };
}

function summarizeTokens(tokens: DesignTokenProps[]): { count: number; kinds: string[] } {
  const kinds = new Set<string>();
  for (const t of tokens) kinds.add(t.type);
  return { count: tokens.length, kinds: [...kinds].sort() };
}
