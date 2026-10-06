import { validateCDF } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';
import { ApiError, ImportApiClient } from '../api-client.js';
import { formatApiError } from '../../lib/error-parser.js';
import { failureFromApiError, exitWithAnalytics } from '../../analytics/index.js';
import type { CommandFailure } from '../../analytics/index.js';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { readJsonFile } from '../helpers/read-token-files.js';

async function die(message: string, fields: CommandFailure = {}): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1, fields);
}

export interface SharedInputs {
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: DTCGTokenEntry[];
  client: ImportApiClient;
  spaceId: string;
  environmentId: string;
  host?: string;
}

async function resolveSharedInputs(file: string): Promise<SharedInputs> {
  const credentials = await readExperiencesCredentials();
  const spaceId = credentials.spaceId;
  const environmentId = credentials.environmentId;
  if (!spaceId) return await die('Error: Contentful space ID is missing; configure it with experiences setup');
  if (!environmentId)
    return await die('Error: Contentful environment ID is missing; configure it with experiences setup');

  const cmaToken = credentials.cmaToken;
  if (!cmaToken) {
    return await die(
      'Error: CMA token is required. Configure it with experiences setup or CONTENTFUL_MANAGEMENT_TOKEN',
    );
  }

  const raw = await readJsonFile('input file', file);
  const result = validateCDF(raw);
  if (!result.valid) {
    return await die(`Error: input file failed schema validation: ${result.errors.map((e) => e.message).join(', ')}`);
  }

  const components = result.components;
  const tokens = result.tokens.map(({ path, entry }) => ({ path, ...entry }));

  const client = new ImportApiClient({
    host: credentials.host,
    cmaToken,
    spaceId,
    environmentId,
  });

  return { components, tokens, client, spaceId, environmentId, host: credentials.host };
}

export async function resolveSharedInputsOrDie(file: string): Promise<SharedInputs> {
  try {
    return await resolveSharedInputs(file);
  } catch (e) {
    if (e instanceof ApiError) return await die(`Error: ${formatApiError(e)}`, failureFromApiError(e));
    throw e;
  }
}
