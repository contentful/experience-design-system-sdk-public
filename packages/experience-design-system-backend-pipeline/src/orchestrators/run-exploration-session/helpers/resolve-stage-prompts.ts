import { resolve } from 'node:path';
import { parsePromptOverrides } from '../../../agents/helpers/prompt-overrides/parse-prompt-overrides.js';
import { loadRendererReference } from './load-renderer-reference.js';
import { throwIfAborted } from '../../../helpers/abort.js';

export type StagePrompt = { skillContentOverride?: string; skillPathOverride?: string };
export async function resolveStagePrompts(options: {
  phase: 'components' | 'detail';
  promptOverrides?: string[];
  promptText?: string;
  promptPath?: string;
  signal?: AbortSignal;
  maxBytes: number;
}): Promise<Record<'explore' | 'tier' | 'verify' | 'check', StagePrompt>> {
  const { overrides, errors } = parsePromptOverrides(options.promptOverrides ?? []);
  if (errors.length) throw new Error(errors.join('; '));
  const read = async (path: string): Promise<string> =>
    (
      await loadRendererReference(
        { kind: 'path', path: resolve(path) },
        { signal: options.signal, maxBytes: options.maxBytes },
      )
    ).text;
  const stage = async (name: string): Promise<StagePrompt> => {
    const override = overrides.get(name);
    if (!override) return {};
    const text = override.kind === 'text' ? override.value : await read(override.value);
    throwIfAborted(options.signal);
    if (Buffer.byteLength(text, 'utf8') > options.maxBytes) throw new Error('Stage prompt override exceeds byte bound');
    return { skillContentOverride: text };
  };
  const explore =
    options.promptText !== undefined
      ? { skillContentOverride: options.promptText }
      : options.promptPath
        ? { skillContentOverride: await read(options.promptPath) }
        : await stage(options.phase === 'components' ? 'select' : 'detail');
  return { explore, tier: await stage('tier'), verify: await stage('verify'), check: await stage('check') };
}
