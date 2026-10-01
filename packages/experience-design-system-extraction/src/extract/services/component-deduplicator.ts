import type { ComponentExtractionResult, RawComponentDefinition } from '../model/component.js';

type ExtractedComponent = RawComponentDefinition;

function getPathPreferenceScore(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const filename = segments.at(-1) ?? '';
  const basename = filename.replace(/\.[^.]+$/, '');

  let score = 0;

  if (/^index\.[jt]sx?$/.test(filename)) score += 100;
  if (basename && segments.at(-2) === basename) score -= 10;

  const componentsSegmentCount = segments.filter((segment) => segment === 'components').length;
  score -= componentsSegmentCount * 8;
  score -= segments.length;

  return score;
}

function getPackageRootInfo(segments: string[]): { rootSegments: string[]; relativeSegments: string[] } | null {
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if ((segment === '.packages' || segment === 'packages') && segments[index + 1]) {
      return {
        rootSegments: segments.slice(0, index + 2),
        relativeSegments: segments.slice(index + 2),
      };
    }
  }

  const srcIndex = segments.lastIndexOf('src');
  if (srcIndex >= 0) {
    return {
      rootSegments: segments.slice(0, srcIndex),
      relativeSegments: segments.slice(srcIndex),
    };
  }

  return null;
}

function getScopeInfo(filePath: string): { rootKey: string; relativeSegments: string[] } | null {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const rootInfo = getPackageRootInfo(segments);

  if (!rootInfo) return null;

  const { rootSegments, relativeSegments } = rootInfo;
  return {
    rootKey: rootSegments.join('/'),
    relativeSegments,
  };
}

function getTopLevelFamilyName(relativeSegments: string[]): string | null {
  const [first, second, third] = relativeSegments;

  if (relativeSegments.length === 1 && first) {
    return first.replace(/\.[^.]+$/, '');
  }

  if (first === 'src' && second === 'components' && third) {
    const fileSegment = relativeSegments[3];
    if (
      fileSegment &&
      (fileSegment === `${third}.tsx` ||
        fileSegment === `${third}.ts` ||
        fileSegment === 'index.tsx' ||
        fileSegment === 'index.ts')
    ) {
      return third;
    }

    return null;
  }

  if (first === 'src' && second) {
    const fileSegment = relativeSegments[2];
    if (
      fileSegment &&
      (fileSegment === `${second}.vue` ||
        fileSegment === `${second}.tsx` ||
        fileSegment === `${second}.ts` ||
        fileSegment === 'index.tsx' ||
        fileSegment === 'index.ts' ||
        fileSegment === 'index.vue')
    ) {
      return second;
    }

    return null;
  }

  if (first) {
    const fileSegment = relativeSegments[1];
    if (
      fileSegment === `${first}.tsx` ||
      fileSegment === `${first}.ts` ||
      fileSegment === `${first}.vue` ||
      fileSegment === 'index.tsx' ||
      fileSegment === 'index.ts' ||
      fileSegment === 'index.vue'
    ) {
      return first;
    }
  }

  return null;
}

function isWithinTopLevelFamily(relativeSegments: string[], componentName: string): boolean {
  const [first, second, third] = relativeSegments;
  const componentFilenames = new Set([
    `${componentName}.tsx`,
    `${componentName}.ts`,
    `${componentName}.vue`,
    'index.tsx',
    'index.ts',
    'index.vue',
  ]);

  if (relativeSegments.length === 1) {
    return new Set([`${componentName}.tsx`, `${componentName}.ts`, `${componentName}.vue`]).has(first);
  }

  if (first === 'src' && second === 'components' && third === componentName) return true;
  if (first === 'components' && second === componentName) return true;
  if (first === 'src' && second === componentName) return true;
  if (first === componentName) return componentFilenames.has(second) || relativeSegments.length > 2;

  return false;
}

function getFamilyScopeKey(
  filePath: string,
  componentName: string,
  topLevelFamiliesByRoot: Map<string, Set<string>>,
): string {
  const normalized = filePath.replace(/\\/g, '/');
  const scopeInfo = getScopeInfo(filePath);

  if (!scopeInfo) return normalized;

  const { rootKey, relativeSegments } = scopeInfo;
  const topLevelFamilies = topLevelFamiliesByRoot.get(rootKey);
  if (topLevelFamilies?.has(componentName) && isWithinTopLevelFamily(relativeSegments, componentName)) {
    return `${rootKey}::${componentName}`;
  }

  const [first, second, third] = relativeSegments;

  if (first === 'src' && second === 'components' && third) return `${rootKey}/src/components/${third}`;
  if (first === 'components' && second) return `${rootKey}/components/${second}`;
  if (first === 'src' && second && relativeSegments.length > 2) return `${rootKey}/src/${second}`;
  if (first && relativeSegments.length > 1) return `${rootKey}/${first}`;

  return rootKey;
}

function choosePreferredComponent(
  existing: ExtractedComponent,
  candidate: ExtractedComponent,
): { winner: ExtractedComponent; loser: ExtractedComponent; reason: string } {
  const existingScore = getPathPreferenceScore(existing.source);
  const candidateScore = getPathPreferenceScore(candidate.source);

  if (candidateScore > existingScore) {
    return {
      winner: candidate,
      loser: existing,
      reason: `preferred ${candidate.source} over ${existing.source} based on path heuristics`,
    };
  }

  if (candidateScore < existingScore) {
    return {
      winner: existing,
      loser: candidate,
      reason: `kept ${existing.source} over ${candidate.source} based on path heuristics`,
    };
  }

  if (candidate.source.length < existing.source.length) {
    return {
      winner: candidate,
      loser: existing,
      reason: `preferred shorter path ${candidate.source} over ${existing.source}`,
    };
  }

  return {
    winner: existing,
    loser: candidate,
    reason: `kept ${existing.source} over ${candidate.source} by stable first-seen order`,
  };
}

export function deduplicateComponents(results: readonly ComponentExtractionResult[]): ComponentExtractionResult {
  const allWarnings: string[] = [];
  const componentsByKey = new Map<string, ExtractedComponent>();
  const keysByName = new Map<string, string[]>();
  const topLevelFamiliesByRoot = new Map<string, Set<string>>();

  for (const result of results) {
    for (const component of result.components) {
      const scopeInfo = getScopeInfo(component.source);
      if (!scopeInfo) continue;

      const familyName = getTopLevelFamilyName(scopeInfo.relativeSegments);
      if (!familyName) continue;

      const existingFamilies = topLevelFamiliesByRoot.get(scopeInfo.rootKey) ?? new Set<string>();
      existingFamilies.add(familyName);
      topLevelFamiliesByRoot.set(scopeInfo.rootKey, existingFamilies);
    }
  }

  for (const result of results) {
    allWarnings.push(...result.warnings);
    for (const component of result.components) {
      const scopeKey = getFamilyScopeKey(component.source, component.name, topLevelFamiliesByRoot);
      const identityKey = `${component.name}::${scopeKey}`;
      const existing = componentsByKey.get(identityKey);
      if (existing) {
        const selected = choosePreferredComponent(existing, component);
        allWarnings.push(
          `Duplicate component "${component.name}" found in ${component.source} (already seen in ${existing.source}); ${selected.reason}`,
        );
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
  };
}
