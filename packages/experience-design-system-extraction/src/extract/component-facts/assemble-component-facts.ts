import { sourceTextLocation } from '../candidates/source-location.js';
import { COMPONENT_FACT_SCHEMA_VERSION } from '../types/component-facts.js';
import type {
  ComponentFactCollectors,
  ComponentFactContext,
  ComponentFactInput,
  ComponentFacts,
} from '../types/component-facts.js';

/** Empty defaults are an unobserved channel, not a claim of collection completeness. */
export function assembleComponentFacts(
  input: ComponentFactInput,
  collectors: ComponentFactCollectors = {},
): ComponentFacts | undefined {
  const context: ComponentFactContext = {
    name: input.name,
    sourcePath: input.sourcePath,
    framework: input.framework,
    sourceText: input.sourceText,
    declaredTypeText: input.declaredTypeText,
    declaration: input.sourceRange ? sourceTextLocation(input.sourcePath, input.sourceText, input.sourceRange) : null,
  };
  const facts: ComponentFacts = { schemaVersion: COMPONENT_FACT_SCHEMA_VERSION };
  function collect<Field extends keyof ComponentFactCollectors>(field: Field): void {
    const value = collectors[field]?.(context);
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) facts[field] = value;
  }
  collect('sourceObservations');
  collect('renderables');
  collect('members');
  collect('childFilters');
  collect('requiresParent');
  collect('nonStatic');
  collect('origin');
  collect('referencedOrigins');
  return Object.keys(facts).length > 1 ? facts : undefined;
}
