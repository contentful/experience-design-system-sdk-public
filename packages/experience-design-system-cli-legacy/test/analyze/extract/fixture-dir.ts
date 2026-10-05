import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { beforeEach, afterEach } from 'vitest';

export function useFixtureDir(prefix: string): {
  writeFixture: (filename: string, content: string) => Promise<string>;
  getTempDir: () => string;
} {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), prefix));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  return {
    writeFixture: async (filename: string, content: string) => {
      const filePath = resolve(tempDir, filename);
      if (filePath !== resolve(tempDir) && !filePath.startsWith(resolve(tempDir) + sep)) {
        throw new Error(`fixture path escapes tempDir: ${filename}`);
      }
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, content);
      return filePath;
    },
    getTempDir: () => tempDir,
  };
}
