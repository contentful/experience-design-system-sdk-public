import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function temporaryEnvironment(prefix: string, paths: Record<string, string>) {
  let directory: string;
  let previous: Record<string, string | undefined>;
  return {
    async open(): Promise<string> {
      directory = await mkdtemp(join(tmpdir(), prefix));
      previous = Object.fromEntries(Object.keys(paths).map((key) => [key, process.env[key]]));
      for (const [key, path] of Object.entries(paths)) process.env[key] = join(directory, path);
      return directory;
    },
    async close(): Promise<void> {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
