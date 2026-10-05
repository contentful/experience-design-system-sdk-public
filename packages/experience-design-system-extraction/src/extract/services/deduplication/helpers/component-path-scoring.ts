import type { RawComponentDefinition } from '../../../types/component.js';
import {
  scoreComponentSourcePath,
  resolvePackageRootInfo,
  resolveComponentScopeInfo,
  resolveTopLevelFamilyName,
} from './component-path-analysis.js';

export { scoreComponentSourcePath, resolvePackageRootInfo, resolveComponentScopeInfo, resolveTopLevelFamilyName };

export function isWithinComponentFamily(relativeSegments: string[], componentName: string): boolean {
  const [first, second, third] = relativeSegments;
  const componentFilenames = new Set([
    `${componentName}.tsx`, `${componentName}.ts`, `${componentName}.vue`,
    'index.tsx', 'index.ts', 'index.vue',
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

  if (candidateScore > existingScore) return { winner: candidate, loser: existing, reason: `preferred ${candidate.source} over ${existing.source} based on path heuristics` };
  if (candidateScore < existingScore) return { winner: existing, loser: candidate, reason: `kept ${existing.source} over ${candidate.source} based on path heuristics` };
  if (candidate.source.length < existing.source.length) return { winner: candidate, loser: existing, reason: `preferred shorter path ${candidate.source} over ${existing.source}` };
  return { winner: existing, loser: candidate, reason: `kept ${existing.source} over ${candidate.source} by stable first-seen order` };
}
