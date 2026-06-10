import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getClient } from '../llm-client.js';
import type { CDFFile } from '../types.js';
import type { CorpusEntry, JudgeResult } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = resolve(__dirname, '..', '..', 'prompts', 'judge.md');

let cachedPrompt: string | undefined;

const loadPrompt = async (): Promise<string> => {
  if (!cachedPrompt) cachedPrompt = await readFile(PROMPT_PATH, 'utf-8');
  return cachedPrompt;
};

const JudgeResultSchema = z.object({
  mapping_quality: z.object({
    score: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    reason: z.string().min(1),
  }),
});

const stripFences = (raw: string): string => {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return match?.[1] ?? trimmed;
};

export async function scoreMappingQuality(cdf: CDFFile, corpus: CorpusEntry): Promise<JudgeResult> {
  const template = await loadPrompt();

  const prompt = template
    .replace('{{REPO}}', corpus.repo)
    .replace('{{EXPECTED_COMPONENTS}}', JSON.stringify(corpus.expectedComponents, null, 2))
    .replace('{{CDF_OUTPUT}}', JSON.stringify(cdf, null, 2));

  const response = await getClient().invoke(prompt, 1024);
  const jsonMatch = /\{[\s\S]*\}/.exec(response);
  if (!jsonMatch) throw new Error(`Judge returned non-JSON response for "${corpus.repo}": ${response.slice(0, 200)}`);

  try {
    return JudgeResultSchema.parse(JSON.parse(stripFences(jsonMatch[0])));
  } catch (err) {
    throw new Error(
      `Judge response for "${corpus.repo}" failed schema validation: ${err instanceof Error ? err.message : String(err)}\nRaw response: ${response.slice(0, 300)}`,
    );
  }
}
