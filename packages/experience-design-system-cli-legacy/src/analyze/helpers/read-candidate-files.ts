import { readFile } from 'node:fs/promises';

export async function readCandidateFiles(
  components: Array<{ sourcePath?: string; source?: string }>,
  extraFiles: string[] = [],
): Promise<Array<{ path: string; content: string }>> {
  const paths = new Set<string>(extraFiles);
  for (const c of components) {
    if (c.sourcePath) paths.add(c.sourcePath);
  }
  const out: Array<{ path: string; content: string }> = [];
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        const content = await readFile(p, 'utf8');
        out.push({ path: p, content });
      } catch {
        void 0;
      }
    }),
  );
  return out;
}
