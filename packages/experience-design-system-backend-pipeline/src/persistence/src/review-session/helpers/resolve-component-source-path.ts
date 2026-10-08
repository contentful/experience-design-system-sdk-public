import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export async function resolveComponentSourcePath(source: string, reviewRoot: string): Promise<string> {
  if (isAbsolute(source)) {
    try {
      await access(source);
      return source;
    } catch {
      throw new Error(`Unable to access component source at ${source}`);
    }
  }

  const candidate = resolve(reviewRoot, source);
  const relativeToRoot = relative(reviewRoot, candidate);

  if (relativeToRoot.startsWith('..') || relativeToRoot === '..' || isAbsolute(relativeToRoot)) {
    throw new Error(
      `Resolved component source is outside the review root: ${source}. Pass --project-root <path> to set the correct base.`,
    );
  }

  try {
    await access(candidate);
    return candidate;
  } catch {
    throw new Error(`Unable to access component source at ${candidate}`);
  }
}
