import { readFile } from 'node:fs/promises';
import { readExperiencesCredentials } from '../../../../../persistence/src/credentials/services/read-credentials.js';
import { validateCDF } from '../../../../shared/cdf/helpers/validate.js';
import type { CDFComponentEntry, DTCGTokenEntry } from '../../../../shared/index.js';
import { ApiClient } from '../../helpers/api-client/api-client.js';

export class ResolveSharedInputsFailure extends Error {
  constructor(
    public readonly reason:
      | { type: 'missing-space-id' }
      | { type: 'missing-environment-id' }
      | { type: 'missing-cma-token' }
      | { type: 'file-not-found'; path: string }
      | { type: 'invalid-json'; path: string }
      | { type: 'invalid-cdf'; errors: string[] },
  ) {
    super(ResolveSharedInputsFailure.format(reason));
  }
  static format(r: ResolveSharedInputsFailure['reason']): string {
    switch (r.type) {
      case 'missing-space-id':
        return 'Contentful space ID is missing; configure it with experiences setup';
      case 'missing-environment-id':
        return 'Contentful environment ID is missing; configure it with experiences setup';
      case 'missing-cma-token':
        return 'CMA token is required. Configure it with experiences setup or CONTENTFUL_MANAGEMENT_TOKEN';
      case 'file-not-found':
        return `file not found: ${r.path}`;
      case 'invalid-json':
        return `input file is not valid JSON: ${r.path}`;
      case 'invalid-cdf':
        return `input file failed schema validation: ${r.errors.join(', ')}`;
    }
  }
}

export interface SharedInputs {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: DTCGTokenEntry[];
  client: ApiClient;
  spaceId: string;
  environmentId: string;
  host?: string;
}

/**
 * Read credentials, read + validate a CDF document, and construct an
 * authenticated ApiClient. Shared pre-flight for the apply command.
 */
export async function resolveSharedInputs(file: string): Promise<SharedInputs> {
  const credentials = await readExperiencesCredentials();
  if (!credentials.spaceId) throw new ResolveSharedInputsFailure({ type: 'missing-space-id' });
  if (!credentials.environmentId) throw new ResolveSharedInputsFailure({ type: 'missing-environment-id' });
  if (!credentials.cmaToken) throw new ResolveSharedInputsFailure({ type: 'missing-cma-token' });

  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ResolveSharedInputsFailure({ type: 'file-not-found', path: file });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ResolveSharedInputsFailure({ type: 'invalid-json', path: file });
  }

  const result = validateCDF(raw);
  if (!result.valid) {
    throw new ResolveSharedInputsFailure({ type: 'invalid-cdf', errors: result.errors.map((e) => e.message) });
  }

  const components = result.components;
  const tokens = result.tokens.map(({ path, entry }) => ({ path, ...entry }));

  const client = new ApiClient({
    host: credentials.host,
    cmaToken: credentials.cmaToken,
    spaceId: credentials.spaceId,
    environmentId: credentials.environmentId,
  });

  return {
    components,
    tokens,
    client,
    spaceId: credentials.spaceId,
    environmentId: credentials.environmentId,
    ...(credentials.host ? { host: credentials.host } : {}),
  };
}
