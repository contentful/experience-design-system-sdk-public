import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function writePhaseArtifact(
  directory: string,
  name: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', signal });
    if (signal?.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
