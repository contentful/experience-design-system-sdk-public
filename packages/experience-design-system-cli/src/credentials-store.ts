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
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'experiences');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function readExperiencesCredentials(): Promise<ExperiencesCredentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ExperiencesCredentials>;
    const host = toConfiguredHost(process.env['EDS_HOST'] ?? parsed.host);
    return {
      spaceId: process.env['CONTENTFUL_SPACE_ID'] ?? parsed.spaceId ?? '',
      environmentId: process.env['CONTENTFUL_ENVIRONMENT_ID'] ?? parsed.environmentId ?? '',
      cmaToken: process.env['CONTENTFUL_MANAGEMENT_TOKEN'] ?? parsed.cmaToken ?? '',
      ...(host ? { host } : {}),
      ...(parsed.agent ? { agent: parsed.agent } : {}),
      ...(parsed.agentModel ? { agentModel: parsed.agentModel } : {}),
      ...(parsed.selectPromptPath ? { selectPromptPath: parsed.selectPromptPath } : {}),
      ...(parsed.generatePromptPath ? { generatePromptPath: parsed.generatePromptPath } : {}),
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
  const { host: _host, agent, agentModel, selectPromptPath, generatePromptPath, ...rest } = creds;
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
