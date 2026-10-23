import { createHash } from 'node:crypto';
import { buildPrompt } from '../../../../agents/index.js';
import type { PromptOptions } from '../../../../agents/types/prompts.js';
import { resolveAgentModel } from '../../../../agents/helpers/resolution/resolve-agent-model.js';
import type { StageOptions } from '../types.js';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    record(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  );
}

/** Run identities and discovery timing do not change the bytes or coverage available to the explorer. */
function sourceForCache(value: unknown): unknown {
  if (!record(value)) return value;
  const source = structuredClone(value);
  for (const key of ['captureId', 'captureDigest', 'envelopeId', 'envelopeDigest', 'sessionId', 'extractionStepId'])
    delete source[key];
  const inventory = source.inventory;
  if (record(inventory) && record(inventory.bounds) && record(inventory.bounds.used))
    delete inventory.bounds.used.discoveryMs;
  return source;
}

function referenceForCache(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const reference: unknown = JSON.parse(value);
    if (!record(reference) || typeof reference.digest !== 'string' || typeof reference.text !== 'string') return value;
    const { retrievedAt: _retrievedAt, ...content } = reference;
    return stableJson(content);
  } catch {
    return value;
  }
}

/** Hash the full logical input, including full diagnostics, rules and skill; never use session IDs as cache identity. */
export async function buildExploreCacheKey(options: PromptOptions, request: StageOptions): Promise<string | undefined> {
  const bedrock = request.bedrock ?? process.env.EDS_BEDROCK === '1';
  const model = resolveAgentModel(request.agent, request.model, bedrock);
  if (!model || model === 'Auto') return undefined;
  const assignment = JSON.parse(options.stageAssignmentInline ?? '{}') as Record<string, unknown>;
  const input = JSON.parse(options.stageInputInline ?? '{}') as Record<string, unknown>;
  delete assignment.identity;
  delete input.storage;
  input.sourceInput = sourceForCache(input.sourceInput);
  input.rendererReference = referenceForCache(input.rendererReference);
  if (Array.isArray(input.componentEvidence))
    for (const entry of input.componentEvidence) {
      if (!record(entry) || !record(entry.facts) || !record(entry.facts.sourceClosure)) continue;
      const closure = entry.facts.sourceClosure;
      if (record(closure.captureBinding)) closure.captureBinding = sourceForCache(closure.captureBinding);
    }
  const prompt = await buildPrompt({
    ...options,
    sharedSource: options.sharedSource
      ? (sourceForCache(options.sharedSource) as PromptOptions['sharedSource'])
      : undefined,
    stageAssignmentInline: stableJson(assignment),
    stageInputInline: stableJson(input),
  });
  return createHash('sha256')
    .update(stableJson({ revision: 2, agent: request.agent, model, bedrock, prompt }))
    .digest('hex');
}
