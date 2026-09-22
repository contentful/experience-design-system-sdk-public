import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { toConfiguredHost } from './host-utils.js';
import { isCompositionMode, type CompositionMode } from './lib/composition-mode.js';

export type ExperiencesCredentials = {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host?: string;
  agent?: string;
  agentModel?: string;
  selectPromptPath?: string;
  generatePromptPath?: string;
  autoFilter?: boolean;
  /** Files to extract at once; unset means one per CPU core. */
  extractConcurrency?: number;
  debug?: boolean;
  analyticsDisabled?: boolean;
  compositionMode?: CompositionMode;
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'experiences');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

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
      ...(typeof parsed.extractConcurrency === 'number' && parsed.extractConcurrency > 0
        ? { extractConcurrency: parsed.extractConcurrency }
        : {}),
      ...(typeof parsed.debug === 'boolean' ? { debug: parsed.debug } : {}),
      ...(typeof parsed.analyticsDisabled === 'boolean' ? { analyticsDisabled: parsed.analyticsDisabled } : {}),
      ...(typeof parsed.compositionMode === 'string' && isCompositionMode(parsed.compositionMode)
        ? { compositionMode: parsed.compositionMode }
        : {}),
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
  const {
    host: _host,
    agent,
    agentModel,
    selectPromptPath,
    generatePromptPath,
    autoFilter,
    extractConcurrency,
    debug,
    analyticsDisabled,
    compositionMode,
    ...rest
  } = creds;
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
        ...(typeof extractConcurrency === 'number' && extractConcurrency > 0 ? { extractConcurrency } : {}),
        ...(typeof debug === 'boolean' ? { debug } : {}),
        ...(typeof analyticsDisabled === 'boolean' ? { analyticsDisabled } : {}),
        ...(compositionMode && isCompositionMode(compositionMode) ? { compositionMode } : {}),
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
