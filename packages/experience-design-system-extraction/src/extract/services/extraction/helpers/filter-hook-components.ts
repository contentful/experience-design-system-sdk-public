import type { ExtractionExclusion, RawComponentDefinition } from '../../../types/component.js';

export function filterHookComponents(components: RawComponentDefinition[]): {
  components: RawComponentDefinition[];
  exclusions: ExtractionExclusion[];
  warnings: string[];
} {
  const exclusions: ExtractionExclusion[] = [];
  const warnings: string[] = [];
  const kept = components.filter((component) => {
    if (!/^use[A-Z]/.test(component.name)) return true;
    warnings.push(`Skipped hook: ${component.name} (hooks are not renderable components)`);
    exclusions.push({
      itemType: 'component',
      name: component.name,
      source: component.source,
      reason: 'Hook names are not renderable components',
      stage: 'component-filter',
    });
    return false;
  });
  return { components: kept, exclusions, warnings };
}
