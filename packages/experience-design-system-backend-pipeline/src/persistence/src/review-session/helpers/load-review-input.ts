import { resolve } from 'node:path';
import type { RawComponentDefinition } from '../../../../steps/extraction/src/types/component.js';
import { createComponentId } from '../helpers/create-component-id.js';
import { resolveComponentSourcePath } from '../helpers/resolve-component-source-path.js';
import type { ReviewComponentRecord } from '../types/review-component.js';
import type { ReviewSessionSnapshot } from '../types/review-session.js';

export type LoadReviewInputOptions = {
  reviewRoot?: string;
};

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
