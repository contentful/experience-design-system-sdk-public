import { readFile } from 'node:fs/promises';
import { DEFAULT_AGENT_NAME, isAgentName } from '@contentful/experience-design-system-generation';
import type { AgentName } from '@contentful/experience-design-system-generation';

export function resolveCompositionAgentName(flagValue?: string): AgentName {
  if (flagValue && isAgentName(flagValue)) return flagValue;
  const env = process.env['EDS_COMPOSITION_AGENT'];
  if (env && isAgentName(env)) return env;
  return DEFAULT_AGENT_NAME;
}

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
