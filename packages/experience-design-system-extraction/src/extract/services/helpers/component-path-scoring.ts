import type { RawComponentDefinition } from '../../model/component.js';

/** Higher score = more preferred as the canonical source for a given component name. */
export function scoreComponentSourcePath(filePath: string): number {
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

export function resolvePackageRootInfo(
  segments: string[],
): { rootSegments: string[]; relativeSegments: string[] } | null {
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

export function resolveComponentScopeInfo(
  filePath: string,
): { rootKey: string; relativeSegments: string[] } | null {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const rootInfo = resolvePackageRootInfo(segments);
  if (!rootInfo) return null;
  return {
    rootKey: rootInfo.rootSegments.join('/'),
    relativeSegments: rootInfo.relativeSegments,
  };
}

export function resolveTopLevelFamilyName(relativeSegments: string[]): string | null {
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

export function isWithinComponentFamily(relativeSegments: string[], componentName: string): boolean {
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

export function resolveDeduplicationScopeKey(
  filePath: string,
  componentName: string,
  topLevelFamiliesByRoot: Map<string, Set<string>>,
): string {
  const normalized = filePath.replace(/\\/g, '/');
  const scopeInfo = resolveComponentScopeInfo(filePath);

  if (!scopeInfo) return normalized;

  const { rootKey, relativeSegments } = scopeInfo;
  const topLevelFamilies = topLevelFamiliesByRoot.get(rootKey);
  if (topLevelFamilies?.has(componentName) && isWithinComponentFamily(relativeSegments, componentName)) {
    return `${rootKey}::${componentName}`;
  }

  const [first, second, third] = relativeSegments;

  if (first === 'src' && second === 'components' && third) return `${rootKey}/src/components/${third}`;
  if (first === 'components' && second) return `${rootKey}/components/${second}`;
  if (first === 'src' && second && relativeSegments.length > 2) return `${rootKey}/src/${second}`;
  if (first && relativeSegments.length > 1) return `${rootKey}/${first}`;

  return rootKey;
}

export function selectPreferredComponentSource(
  existing: RawComponentDefinition,
  candidate: RawComponentDefinition,
): { winner: RawComponentDefinition; loser: RawComponentDefinition; reason: string } {
  const existingScore = scoreComponentSourcePath(existing.source);
  const candidateScore = scoreComponentSourcePath(candidate.source);

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
