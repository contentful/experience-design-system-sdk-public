import { readV1Store, writeV1Store } from '../utils/v1-store.js';

export type V1Credentials = {
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  [key: string]: string | undefined;
};

export const EMPTY_CREDENTIALS: V1Credentials = {
  spaceId: '',
  environmentId: '',
  cmaToken: '',
  host: '',
};

export async function readCredentials(): Promise<V1Credentials> {
  const store = await readV1Store();
  return {
    spaceId: (store.spaceId as string) || '',
    environmentId: (store.environmentId as string) || '',
    cmaToken: (store.cmaToken as string) || '',
    host: (store.host as string) || '',
  };
}

export async function writeCredentials(config: V1Credentials): Promise<void> {
  const existing = await readV1Store();
  const merged: Record<string, unknown> = {
    ...existing,
    ...config,
  };
  Object.keys(merged).forEach((k) => {
    if (!merged[k]) delete merged[k];
  });
  await writeV1Store(merged);
}
