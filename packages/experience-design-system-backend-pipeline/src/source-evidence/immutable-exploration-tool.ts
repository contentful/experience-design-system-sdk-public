import { readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Snapshot a standalone tool so rebuilding installed packages cannot remove a running scope's executable. */
export async function snapshotExplorationTool(
  tool: 'read' | 'validate',
  directory: string,
  signal?: AbortSignal,
): Promise<string> {
  const sibling = new URL(`../../tools/${tool}.mjs`, import.meta.url);
  const bundled = existsSync(sibling)
    ? sibling
    : new URL(`../tools/${tool}.mjs`, import.meta.resolve('@contentful/experience-design-system-backend-pipeline'));
  const bytes = await readFile(bundled, { signal });
  const path = join(await realpath(directory), `${tool}.mjs`);
  await writeFile(path, bytes, { mode: 0o400, signal });
  signal?.throwIfAborted();
  return path;
}
