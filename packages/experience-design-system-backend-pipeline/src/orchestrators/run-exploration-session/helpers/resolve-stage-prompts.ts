import { resolve } from 'node:path';
import { parsePromptOverrides } from '../../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { readSkillFile } from '../../../agents/prompts/helpers/read-skill-file.js';
import type { Skill } from '../../../agents/types/prompts.js';
import { loadRendererReference } from './load-renderer-reference.js';
import { throwIfAborted } from '../../../helpers/abort.js';

export type StagePrompt = { skillContentOverride?: string; skillPathOverride?: string };
export async function resolveStagePrompts(options: {
  phase: 'components' | 'detail';
  promptOverrides?: string[];
  promptText?: string;
  promptPath?: string;
  signal?: AbortSignal;
}): Promise<Record<'explore' | 'tier' | 'verify' | 'check', StagePrompt>> {
  const { overrides, errors } = parsePromptOverrides(options.promptOverrides ?? []);
  if (errors.length) throw new Error(errors.join('; '));
  const read = async (path: string): Promise<string> =>
    (await loadRendererReference({ kind: 'path', path: resolve(path) }, { signal: options.signal })).text;
  const stage = async (name: string, skill: Skill): Promise<StagePrompt> => {
    throwIfAborted(options.signal);
    const override = overrides.get(name);
    const text = !override
      ? await readSkillFile(skill)
      : override.kind === 'text'
        ? override.value
        : await read(override.value);
    throwIfAborted(options.signal);
    return { skillContentOverride: text };
  };
  const explore =
    options.promptText !== undefined
      ? { skillContentOverride: options.promptText }
      : options.promptPath
        ? { skillContentOverride: await read(options.promptPath) }
        : await stage(
            options.phase === 'components' ? 'select' : 'detail',
            options.phase === 'components' ? 'explore-components' : 'explore-inventory',
          );
  return {
    explore,
    tier: await stage('tier', 'tier'),
    verify: await stage('verify', 'verify'),
    check: await stage('check', 'check'),
  };
}
