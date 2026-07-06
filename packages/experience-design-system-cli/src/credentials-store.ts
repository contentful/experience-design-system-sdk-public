import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { toConfiguredHost } from './host-utils.js';

export type ExperiencesCredentials = {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
  agent?: string;
  agentModel?: string;
  /** Feature 8: persisted custom prompt path for `analyze select-agent`. */
  selectPromptPath?: string;
  /** Feature 8: persisted custom prompt path for `generate components`. */
  generatePromptPath?: string;
  autoFilter?: boolean;
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'experiences');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

/**
 * Read persisted Contentful credentials.
 *
 * Precedence (INTEG-4410): what the operator saved on disk via
 * `experiences setup` or the wizard's credentials step wins over ambient
 * `CONTENTFUL_*` / `EDS_HOST` env vars. Env vars are still consulted as a
 * fallback when the field on disk is missing or empty — this preserves
 * back-compat for CI / scripts that only export env and never call setup.
 *
 * The pre-INTEG-4410 order (env-first) silently shadowed saved values, so
 * operators who saved a different space via setup kept seeing the env one
 * pre-filled in the wizard. The saved value now wins; the env fallback only
 * fires when the on-disk field is empty.
 */
export async function readExperiencesCredentials(): Promise<ExperiencesCredentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ExperiencesCredentials>;
    // Disk value wins when non-empty; env is the fallback.
    const host = toConfiguredHost(parsed.host || process.env['EDS_HOST']);
    return {
      spaceId: parsed.spaceId || process.env['CONTENTFUL_SPACE_ID'] || '',
      environmentId: parsed.environmentId || process.env['CONTENTFUL_ENVIRONMENT_ID'] || '',
      cmaToken: parsed.cmaToken || process.env['CONTENTFUL_MANAGEMENT_TOKEN'] || '',
      ...(host ? { host } : {}),
      ...(parsed.agent ? { agent: parsed.agent } : {}),
      ...(parsed.agentModel ? { agentModel: parsed.agentModel } : {}),
      ...(parsed.selectPromptPath ? { selectPromptPath: parsed.selectPromptPath } : {}),
      ...(parsed.generatePromptPath ? { generatePromptPath: parsed.generatePromptPath } : {}),
      ...(typeof parsed.autoFilter === 'boolean' ? { autoFilter: parsed.autoFilter } : {}),
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
  const { host: _host, agent, agentModel, selectPromptPath, generatePromptPath, autoFilter, ...rest } = creds;
  const host = toConfiguredHost(creds.host);
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(
    CREDENTIALS_PATH,
    JSON.stringify(
      {
        ...rest,
        ...(host ? { host } : {}),
        ...(agent ? { agent } : {}),
        ...(agentModel ? { agentModel } : {}),
        ...(selectPromptPath ? { selectPromptPath } : {}),
        ...(generatePromptPath ? { generatePromptPath } : {}),
        ...(typeof autoFilter === 'boolean' ? { autoFilter } : {}),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}

export function experiencesCredentialsPath(): string {
  return CREDENTIALS_PATH;
}
