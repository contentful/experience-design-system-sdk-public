export function scoreComponentSourcePath(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const filename = segments.at(-1) ?? '';
  const basename = filename.replace(/\.[^.]+$/, '');
  let score = 0;
  if (/^index\.[jt]sx?$/.test(filename)) score += 100;
  if (basename && segments.at(-2) === basename) score -= 10;
  score -= segments.filter((segment) => segment === 'components').length * 8;
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

export function resolveComponentScopeInfo(filePath: string): { rootKey: string; relativeSegments: string[] } | null {
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

  if (relativeSegments.length === 1 && first) return first.replace(/\.[^.]+$/, '');

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
