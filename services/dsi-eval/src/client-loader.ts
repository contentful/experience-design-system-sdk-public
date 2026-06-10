import { resolve } from 'node:path';
import type { LlmClient } from './llm-client.js';

export async function loadLlmClient(): Promise<LlmClient> {
  const modulePath = process.env.DSI_EVAL_LLM_CLIENT;
  if (!modulePath) {
    throw new Error(
      'DSI_EVAL_LLM_CLIENT is not set.\n' +
      'Point it to your LLM client module, e.g.:\n' +
      '  DSI_EVAL_LLM_CLIENT=./.corpus-repo/dist/bedrock-client.js',
    );
  }
  const resolved = resolve(process.cwd(), modulePath);
  const mod = await import(resolved) as Record<string, unknown>;
  if (typeof mod.createClient !== 'function') {
    throw new Error(`${modulePath} must export a createClient() function`);
  }
  return (mod.createClient as () => LlmClient)();
}
