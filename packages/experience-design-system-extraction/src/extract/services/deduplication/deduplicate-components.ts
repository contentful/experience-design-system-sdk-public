import type { ComponentExtractionResult, ExtractionExclusion, RawComponentDefinition } from '../../types/component.js';
import {
  resolveComponentScopeInfo,
  resolveTopLevelFamilyName,
  resolveDeduplicationScopeKey,
  selectPreferredComponentSource,
} from './helpers/component-path-scoring.js';

export function deduplicateComponents(results: readonly ComponentExtractionResult[]): ComponentExtractionResult {
  const allWarnings: string[] = [];
  const exclusions: ExtractionExclusion[] = [];
  const componentsByKey = new Map<string, RawComponentDefinition>();
  const keysByName = new Map<string, string[]>();
  const topLevelFamiliesByRoot = new Map<string, Set<string>>();

  for (const result of results) {
    for (const component of result.components) {
      const scopeInfo = resolveComponentScopeInfo(component.source);
      if (!scopeInfo) continue;

      const familyName = resolveTopLevelFamilyName(scopeInfo.relativeSegments);
      if (!familyName) continue;

      const existingFamilies = topLevelFamiliesByRoot.get(scopeInfo.rootKey) ?? new Set<string>();
      existingFamilies.add(familyName);
      topLevelFamiliesByRoot.set(scopeInfo.rootKey, existingFamilies);
    }
  }

  for (const result of results) {
    allWarnings.push(...result.warnings);
    exclusions.push(...(result.exclusions ?? []));
    for (const component of result.components) {
      const scopeKey = resolveDeduplicationScopeKey(component.source, component.name, topLevelFamiliesByRoot);
      const identityKey = `${component.name}::${scopeKey}`;
      const existing = componentsByKey.get(identityKey);
      if (existing) {
        const selected = selectPreferredComponentSource(existing, component);
        allWarnings.push(
          `Duplicate component "${component.name}" found in ${component.source} (already seen in ${existing.source}); ${selected.reason}`,
        );
        exclusions.push({
          itemType: 'component',
          name: selected.loser.name,
          source: selected.loser.source,
          reason: `duplicate identity; ${selected.reason}`,
          stage: 'duplicate-filter',
        });
        componentsByKey.set(identityKey, selected.winner);
        continue;
      }

      const existingKeys = keysByName.get(component.name) ?? [];
      const crossPackageKey = existingKeys.find((key) => key !== identityKey);
      if (crossPackageKey) {
        const crossPackageComponent = componentsByKey.get(crossPackageKey);
        if (crossPackageComponent) {
          allWarnings.push(
            `Component name collision "${component.name}" found in ${component.source} (also seen in ${crossPackageComponent.source})`,
          );
        }
      }

      componentsByKey.set(identityKey, component);
      keysByName.set(component.name, [...existingKeys, identityKey]);
    }
  }

  return {
    components: [...componentsByKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings: allWarnings,
    exclusions,
  };
}
