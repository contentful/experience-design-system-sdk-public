import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { RawComponentDefinition } from '../../types.js';
import type { ReviewComponentRecord, ReviewSessionSnapshot } from './types.js';

export type LoadReviewInputOptions = {
  reviewRoot?: string;
};

function createComponentId(name: string, resolvedSourcePath: string): string {
  const sourceHash = createHash('sha256').update(`${name}:${resolvedSourcePath}`).digest('hex').slice(0, 12);
  return `${name}-${sourceHash}`;
}

async function resolveComponentSourcePath(source: string, reviewRoot: string): Promise<string> {
  // Absolute paths stored in the DB are used directly — no reviewRoot boundary check needed.
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

export async function loadReviewInput(
  components: RawComponentDefinition[],
  options: LoadReviewInputOptions = {},
): Promise<ReviewSessionSnapshot> {
  const reviewRoot = resolve(options.reviewRoot ?? process.cwd());

  const records = await Promise.all(
    components.map(async (component): Promise<ReviewComponentRecord> => {
      let resolvedSourcePath: string;

      try {
        resolvedSourcePath = await resolveComponentSourcePath(component.source, reviewRoot);
      } catch (error) {
        throw new Error(
          `Unable to access component source for ${component.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return {
        id: createComponentId(component.name, resolvedSourcePath),
        name: component.name,
        resolvedSourcePath,
        sourceCode: null,
        originalProposal: component,
        editedProposal: structuredClone(component),
        status: 'needs-review',
      };
    }),
  );

  return { components: records };
}
