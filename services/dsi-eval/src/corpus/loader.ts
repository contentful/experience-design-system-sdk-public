import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CorpusEntry } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, '..', '..', 'corpus');

const CorpusEntrySchema = z.object({
  repo: z.string(),
  rawComponents: z.array(z.object({
    name: z.string(),
    source: z.string(),
    framework: z.enum(['react', 'next', 'vue', 'astro', 'web-component', 'stencil']),
    props: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      category: z.enum(['content', 'design', 'state']).optional(),
      defaultValue: z.string().optional(),
      allowedValues: z.array(z.string()).optional(),
      description: z.string().optional(),
      tokenReference: z.string().optional(),
    })),
    slots: z.array(z.object({
      name: z.string(),
      isDefault: z.boolean(),
      description: z.string().optional(),
      allowedComponents: z.array(z.string()).optional(),
    })),
  })),
  expectedComponents: z.array(z.object({
    name: z.string(),
    verdict: z.enum(['accurate', 'partial', 'missed', 'incorrect']),
    expectedProps: z.record(z.object({
      category: z.enum(['content', 'design', 'state']),
      type: z.enum(['string', 'richtext', 'media', 'link', 'enum', 'token', 'boolean']),
    })).optional(),
  })),
});

export async function loadCorpus(repoFilter?: string): Promise<CorpusEntry[]> {
  const files = await readdir(CORPUS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  const entries: CorpusEntry[] = [];

  for (const file of jsonFiles) {
    const raw = JSON.parse(await readFile(join(CORPUS_DIR, file), 'utf-8'));
    const result = CorpusEntrySchema.safeParse(raw);
    if (!result.success) {
      console.warn(`[corpus] skipping ${file} — not a valid corpus entry`);
      continue;
    }
    if (!repoFilter || result.data.repo === repoFilter) {
      entries.push(result.data as CorpusEntry);
    }
  }

  if (entries.length === 0) {
    throw new Error(
      repoFilter
        ? `No corpus entry found for repo: ${repoFilter}`
        : 'No corpus entries found. Add JSON files to services/dsi-eval/corpus/'
    );
  }

  return entries;
}
