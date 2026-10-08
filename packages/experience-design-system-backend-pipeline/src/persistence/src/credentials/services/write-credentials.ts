import { readSettings, writeSettings } from '../../session/helpers/config-root.js';
import { toConfiguredHost } from '../helpers/host-utils.js';
import { OWNED_KEYS } from '../helpers/owned-keys.js';
import type { ExperiencesCredentials } from '../types/credentials.js';

export async function writeExperiencesCredentials(creds: ExperiencesCredentials): Promise<void> {
  const { host: _host, ...rest } = creds;
  const host = toConfiguredHost(creds.host);
  const optional = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ''));
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
