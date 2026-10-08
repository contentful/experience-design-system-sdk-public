import { readSettings } from '../../session/helpers/config-root.js';
import { toConfiguredHost } from '../helpers/host-utils.js';
import type { ExperiencesCredentials } from '../types/credentials.js';

export async function readExperiencesCredentials(): Promise<ExperiencesCredentials> {
  try {
    const parsed = (await readSettings()) as Partial<ExperiencesCredentials>;
    const host = toConfiguredHost(parsed.host || process.env['EDS_HOST']);
    return {
      spaceId: parsed.spaceId || process.env['CONTENTFUL_SPACE_ID'] || '',
      environmentId: parsed.environmentId || process.env['CONTENTFUL_ENVIRONMENT_ID'] || '',
      cmaToken: parsed.cmaToken || process.env['CONTENTFUL_MANAGEMENT_TOKEN'] || '',
      ...(host ? { host } : {}),
      ...(parsed.agent ? { agent: parsed.agent } : {}),
      ...(parsed.agentModel ? { agentModel: parsed.agentModel } : {}),
      ...(parsed.generatePromptPath ? { generatePromptPath: parsed.generatePromptPath } : {}),
      ...(typeof parsed.debug === 'boolean' ? { debug: parsed.debug } : {}),
      ...(typeof parsed.noColor === 'boolean' ? { noColor: parsed.noColor } : {}),
      ...(typeof parsed.analyticsDisabled === 'boolean' ? { analyticsDisabled: parsed.analyticsDisabled } : {}),
    };
  } catch {
    const host = toConfiguredHost(process.env['EDS_HOST']);
    return {
      spaceId: process.env['CONTENTFUL_SPACE_ID'] ?? '',
      environmentId: process.env['CONTENTFUL_ENVIRONMENT_ID'] ?? '',
      cmaToken: process.env['CONTENTFUL_MANAGEMENT_TOKEN'] ?? '',
      ...(host ? { host } : {}),
    };
  }
}
