import {
  copyTokensFromCache,
  loadCDFComponents,
  loadDTCGTokens,
  openPipelineDb,
  readTokensFromPath,
  storeDTCGTokens,
} from '@contentful/experience-design-system-backend-pipeline';
import { shouldRunMapTokens } from './logic.js';
import type { GenerationInput } from './types.js';

export interface MapTokensPlan {
  /** False when there is nothing to map, in which case the command is not run. */
  eligible: boolean;
  mappablePropCount: number;
  rawTokenCount: number;
}

/**
 * Prepares the generated session for token mapping and says whether it is worth running. The map tokens command works
 * on one session, so the token universe is copied into the generated one: from the token session when extraction made
 * one, or restored from the saved tokens.json when an existing catalog was reused (there is no token session then).
 * Then it counts the design props that are tokens and the raw tokens. Reads and writes the pipeline database.
 */
export async function prepareMapTokens(
  input: Pick<GenerationInput, 'tokenSessionId' | 'tokensPath'>,
  generatedSessionId: string,
): Promise<MapTokensPlan> {
  const db = openPipelineDb();
  try {
    if (input.tokenSessionId && input.tokenSessionId !== generatedSessionId) {
      copyTokensFromCache(db, input.tokenSessionId, generatedSessionId);
    } else if (!input.tokenSessionId && input.tokensPath) {
      const tokens = await readTokensFromPath({ flag: 'tokens', path: input.tokensPath });
      storeDTCGTokens(db, generatedSessionId, [], tokens);
    }
    const mappablePropCount = loadCDFComponents(db, generatedSessionId).reduce(
      (count, { entry }) =>
        count +
        Object.values(entry.$properties).filter((prop) => prop.$type === 'token' && prop.$category === 'design').length,
      0,
    );
    const rawTokenCount = loadDTCGTokens(db, generatedSessionId).tokens.length;
    return {
      eligible: shouldRunMapTokens({ mappablePropCount, rawTokenCount }),
      mappablePropCount,
      rawTokenCount,
    };
  } finally {
    db.close();
  }
}
