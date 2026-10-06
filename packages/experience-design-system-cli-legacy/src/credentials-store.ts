import { configFilePath, readSettings, writeSettings } from '@contentful/experience-design-system-types/config';
import { toConfiguredHost } from './host-utils.js';

export type ExperiencesCredentials = {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
  agent?: string;
  agentModel?: string;
  /** Feature 8: persisted custom prompt path for `generate components`. */
  generatePromptPath?: string;
  /** Write JSONL trace of every command decision to ~/.contentful/experience-design-system-cli/debug/. */
  debug?: boolean;
  /** Print plain text with no color; an exported NO_COLOR still wins. */
  noColor?: boolean;
  analyticsDisabled?: boolean;
};

// Every key this store owns. Cleared on write so an emptied value really disappears.
const OWNED_KEYS = [
  'spaceId',
  'environmentId',
  'cmaToken',
  'host',
  'agent',
  'agentModel',
  'generatePromptPath',
  'debug',
  'noColor',
  'analyticsDisabled',
];

export async function readExperiencesCredentials(): Promise<ExperiencesCredentials> {
  try {
    const parsed = (await readSettings()) as Partial<ExperiencesCredentials>;
    // Disk value wins when non-empty; env is the fallback.
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

export async function writeExperiencesCredentials(creds: ExperiencesCredentials): Promise<void> {
  const { host: _host, ...rest } = creds;
  const host = toConfiguredHost(creds.host);
  const optional = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''));
  // Merge into the shared config so keys owned by the new CLI (debugMode, defaults) survive.
  const current = await readSettings();
  for (const key of OWNED_KEYS) delete current[key];
  await writeSettings({
    ...current,
    ...optional,
    spaceId: rest.spaceId,
    environmentId: rest.environmentId,
    cmaToken: rest.cmaToken,
    ...(host ? { host } : {}),
  });
}

export function experiencesCredentialsPath(): string {
  return configFilePath();
}
