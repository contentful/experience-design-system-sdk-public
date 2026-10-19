import type { AgentDebugEvent } from '../../../agents/types/agent-run.js';
import { bucketComponentProps } from '@contentful/experience-design-system-extraction';
import { stripPropProvenance } from '../../../agents/prompts/helpers/strip-prop-provenance.js';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentName } from '../../../agents/types/agent-name.js';
import type { AgentInvoker } from '../../../agents/types/invoker.js';
import { buildPrompt } from '../../../agents/prompts/build-prompt.js';
import { describeAgentFailure } from '../../../agents/helpers/metadata/describe-agent-failure.js';
import { invokeAgentWithOutput } from '../../../agents/services/invoke-agent-with-output.js';
import { parseToolCalls } from '../../../agents/parsers/parse-tool-calls.js';
import {
  applyToolCalls,
  computeComponentInputHash,
  copyComponentFromCache,
  loadComponentSourceRef,
  renameEmptySlots,
  storeCache,
  type RawComponentWithId,
} from '../../../persistence/src/session/repositories/db.js';
import { normalizeComponentForCache } from '../../../steps/generation/src/helpers/components/normalize-component-for-cache.js';
import { resolveComponentCache } from '../../../steps/generation/src/helpers/components/resolve-component-cache.js';
import { summarizeForGenerateAgent } from '../../../steps/generation/src/controller/existing-entities/summarize-for-generate.js';
import type { ExistingContentfulEntities } from '../../../steps/generation/src/types/existing-entities.js';
import type { GeneratedComponentResult, GenerateComponentsProgress } from '../types.js';
import { buildCachedComponentResult } from './build-cached-component-result.js';
import { buildFailedComponentResult } from './build-failed-component-result.js';

const DEFAULT_TIMEOUT_MS = Number(process.env['EDS_AGENT_TIMEOUT_MS'] ?? 5 * 60 * 1000);
const RETRY_BACKOFF_MS = Number(process.env['EDS_RETRY_BACKOFF_MS'] ?? 5_000);

export interface RunOneGenerateComponentOptions {
  db: DatabaseSync;
  sessionId: string;
  invoker: AgentInvoker;
  agent: AgentName;
  model: string | undefined;
  tokensInline: string | undefined;
  tokenMapInline: string | undefined;
  verbose: boolean;
  noCache: boolean;
  skillPathOverride: string | undefined;
  skillContentOverride: string | undefined;
  promptHash: string;
  existingContentfulEntities: ExistingContentfulEntities | null | undefined;
  existingTokensInline: string | undefined;
  precomputedCachedNames: ReadonlySet<string>;
  allowedComponentNames: ReadonlySet<string>;
  onProgress: ((event: GenerateComponentsProgress) => void) | undefined;
  onDebugEvent?: AgentDebugEvent;
}

export async function runOneGenerateComponent(
  options: RunOneGenerateComponentOptions,
  component: RawComponentWithId,
  index: number,
  total: number,
): Promise<GeneratedComponentResult> {
  const {
    db,
    sessionId,
    invoker,
    agent,
    model,
    tokensInline,
    tokenMapInline,
    verbose,
    noCache,
    skillPathOverride,
    skillContentOverride,
    promptHash,
    existingContentfulEntities,
    existingTokensInline,
    precomputedCachedNames,
    allowedComponentNames,
    onProgress,
  } = options;

  const { renames } = renameEmptySlots(db, sessionId, component.component_id, component.name, component.slots.length);
  let effectiveSlots = component.slots;
  if (renames.length > 0) {
    const renameMap = new Map(renames.map((r) => [r.oldName, r.newName]));
    effectiveSlots = component.slots.map((s) => (renameMap.has(s.name) ? { ...s, name: renameMap.get(s.name)! } : s));
    for (const rename of renames) {
      onProgress?.({
        kind: 'component:slot-renamed',
        componentName: component.name,
        oldName: rename.oldName,
        newName: rename.newName,
      });
    }
  }
  effectiveSlots = effectiveSlots.map((slot) =>
    slot.allowedComponents
      ? { ...slot, allowedComponents: slot.allowedComponents.filter((name) => allowedComponentNames.has(name)) }
      : slot,
  );
  const cacheComponent = normalizeComponentForCache(component);

  if (!noCache && precomputedCachedNames.has(component.name)) {
    onProgress?.({ kind: 'component:cached', index, total, name: component.name, pinned: false });
    return buildCachedComponentResult(component.name);
  }

  if (!noCache) {
    const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames);
    if (resolution && !resolution.humanEdited) {
      copyComponentFromCache(db, resolution.entry.sourceSessionId, sessionId, component.component_id, true, {
        allowedComponentNames,
      });
      storeCache(
        db,
        computeComponentInputHash(cacheComponent),
        'component',
        component.component_id,
        resolution.entry.sourceSessionId,
        resolution.entry.humanEdited,
        promptHash,
      );
      onProgress?.({ kind: 'component:cached', index, total, name: component.name, pinned: false });
      return buildCachedComponentResult(component.name);
    }
    if (resolution?.humanEdited) {
      copyComponentFromCache(db, resolution.entry.sourceSessionId, sessionId, component.component_id, true, {
        allowedComponentNames,
      });
      onProgress?.({ kind: 'component:cached', index, total, name: component.name, pinned: true });
      return buildCachedComponentResult(component.name, [
        `${component.name}: source changed but human edits preserved`,
      ]);
    }
  }

  const componentBuckets = bucketComponentProps(component);
  options.onDebugEvent?.('prop-buckets.generate', { ...componentBuckets });

  const rawComponentsInline = JSON.stringify(
    [
      {
        name: component.name,
        source: component.source,
        framework: component.framework,
        props: component.props.map(stripPropProvenance),
        slots: effectiveSlots,
      },
    ],
    null,
    2,
  );
  const sourceRef = await loadComponentSourceRef(
    component.name,
    component.sourcePath ?? component.source,
    component.props.map((p) => p.name),
    component.props.map((p) => p.type),
  );
  const existingComponentsInline = existingContentfulEntities
    ? JSON.stringify(summarizeForGenerateAgent(existingContentfulEntities, component.name))
    : undefined;
  const prompt = await buildPrompt({
    skill: 'components',
    mode: 'autonomous',
    rawComponentsInline,
    propBucketsInline: JSON.stringify(componentBuckets),
    tokensInline,
    tokenMapInline,
    outDir: process.cwd(),
    componentName: component.name,
    componentSourceRefs: [sourceRef],
    skillPathOverride,
    skillContentOverride,
    existingComponentsInline,
    existingTokensInline,
    componentAllowlistInline: JSON.stringify([...allowedComponentNames].sort()),
  });

  const maxAttempts = 2;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
    onProgress?.({ kind: 'component:started', index, total, name: component.name, attempt, maxAttempts });
    const { result } = await invokeAgentWithOutput(
      invoker,
      { agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS },
      verbose,
    );

    if (result.timedOut) {
      const error = `timed out after ${DEFAULT_TIMEOUT_MS / 60000} minutes`;
      onProgress?.({ kind: 'component:failed', index, total, name: component.name, error });
      return buildFailedComponentResult(component.name, error, renames.length);
    }

    if (result.exitCode !== 0) {
      lastError = describeAgentFailure(result);
      continue;
    }

    const { calls, warnings } = parseToolCalls(result.stdout);
    if (calls.length === 0) {
      lastError = describeAgentFailure(result);
      continue;
    }

    const applied = applyToolCalls(db, sessionId, component.component_id, component.name, calls, warnings, {
      allowedComponentNames,
    });
    if (!noCache) {
      storeCache(
        db,
        computeComponentInputHash(cacheComponent),
        'component',
        component.component_id,
        sessionId,
        false,
        promptHash,
      );
    }
    onProgress?.({
      kind: 'component:completed',
      index,
      total,
      name: component.name,
      classified: applied.classified,
      excluded: applied.excluded,
      slots: applied.slots,
      warnings: applied.warnings,
    });
    return {
      componentName: component.name,
      classified: applied.classified,
      excluded: applied.excluded,
      slots: applied.slots,
      warnings: applied.warnings,
      failed: false,
      cached: false,
      renamedSlotsCount: renames.length,
    };
  }

  onProgress?.({ kind: 'component:failed', index, total, name: component.name, error: lastError });
  return buildFailedComponentResult(component.name, lastError, renames.length);
}
