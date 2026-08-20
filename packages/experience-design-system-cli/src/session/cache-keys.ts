/**
 * Hash helpers for the fine-grained LLM cache.
 *
 * Three layers of cache (extract, select, generate) all need stable content
 * hashes for cache-key derivation. Keep these primitives in one place so the
 * algorithm and encoding never drift between callers.
 *
 * All hashes are sha256 hex (64 chars). No npm deps — uses node:crypto.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveSkillPath, type Skill } from '@contentful/experience-design-system-generation';

/** sha256 hex of a string. Stable across runs. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** sha256 hex of a file's UTF-8 content. */
export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf8');
  return hashContent(content);
}

/**
 * Hash the prompt content for a skill — either the bundled skill file shipped
 * with the CLI, or a custom override path. Used to key the select_cache and
 * generation_cache so cache entries invalidate when the prompt itself changes
 * (including bundled-skill updates across CLI versions).
 *
 * Also folds in the resolved agent and model: a cache hit must not stand in
 * for an agent run that was never made with the currently requested
 * agent/model, or `--agent`/`--model` overrides would appear to be ignored
 * whenever a prior cache entry already exists for the same input/prompt.
 *
 * @param skill — which skill (matches resolveSkillPath in prompt-builder)
 * @param agent — resolved agent name for this run
 * @param model — resolved model for this run (undefined resolves to the agent's default)
 * @param skillPathOverride — optional absolute/relative path to a custom prompt
 */
export async function hashPromptForSkill(
  skill: Skill,
  agent: string,
  model: string | undefined,
  skillPathOverride?: string,
): Promise<string> {
  const promptHash = skillPathOverride
    ? await hashFile(resolve(skillPathOverride))
    : await hashFile(resolveSkillPath(skill));
  return hashContent(`${promptHash}|${agent}|${model ?? ''}`);
}
