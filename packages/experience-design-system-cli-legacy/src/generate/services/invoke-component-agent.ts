import { buildPrompt, describeAgentFailure, parseToolCallLines } from '@contentful/experience-design-system-generation';
import type { AgentInvoker, AgentName } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '../../types.js';
import {
  applyToolCalls,
  computeComponentInputHash,
  copyComponentFromCache,
  loadComponentSourceRef,
  renameEmptySlots,
  storeCache,
} from '../../session/db.js';
import type { openPipelineDb } from '../../session/db.js';
import type { ExistingContentfulEntities } from '../../helpers/fetch-existing-contentful-entities.js';
import { summarizeForGenerateAgent } from '../../helpers/summarize-existing-contentful-entities.js';
import { invokeAgentWithOutput } from '../../lib/agent-output.js';
import { c } from '../../output/format.js';
import { normalizeComponentForCache } from '../helpers/normalize-component-for-cache.js';
import { resolveComponentCache } from './resolve-component-cache.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);
const RETRY_BACKOFF_MS = Number(process.env.EDS_RETRY_BACKOFF_MS ?? 5_000);

export interface ComponentRunResult {
  componentName: string;
  classified: number;
  excluded: number;
  slots: number;
  warnings: string[];
  failed: boolean;
  error?: string;
  cached?: boolean;
  renamedSlotsCount: number;
}

export interface ComponentAgentOptions {
  agent: AgentName;
  model: string | undefined;
  invoker: AgentInvoker;
  db: ReturnType<typeof openPipelineDb>;
  sessionId: string;
  tokensInline: string | undefined;
  tokenMapInline: string | undefined;
  verbose: boolean;
  noCache: boolean;
  skillPathOverride: string | undefined;
  skillContentOverride: string | undefined;
  promptHash: string;
  existingContentfulEntities: ExistingContentfulEntities | undefined;
  existingTokensInline: string | undefined;
  precomputedCachedNames: ReadonlySet<string>;
  allowedComponentNames: ReadonlySet<string>;
}

function createCachedComponentResult(componentName: string, warnings: string[] = []): ComponentRunResult {
  return {
    componentName,
    classified: 0,
    excluded: 0,
    slots: 0,
    warnings,
    failed: false,
    cached: true,
    renamedSlotsCount: 0,
  };
}

function writeCachedComponentStatus(position: string, componentName: string, pinned: boolean): void {
  const status = pinned ? c.cyan('pinned (human-edited)') : c.green('cached');
  process.stderr.write(`  ${position}  ${c.bold(componentName)}  ${status}\n`);
}

export async function invokeComponentAgent(
  options: ComponentAgentOptions,
  component: RawComponentDefinition & { component_id: string },
  index: number,
  total: number,
): Promise<ComponentRunResult> {
  const {
    agent,
    model,
    invoker,
    db,
    sessionId,
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
  } = options;
  const pos = c.dim(`[${index + 1}/${total}]`);

  const { renames, warnings: renameWarnings } = renameEmptySlots(
    db,
    sessionId,
    component.component_id,
    component.name,
    component.slots.length,
  );
  let effectiveSlots = component.slots;
  if (renames.length > 0) {
    const renameMap = new Map(renames.map((r) => [r.oldName, r.newName]));
    effectiveSlots = component.slots.map((s) => (renameMap.has(s.name) ? { ...s, name: renameMap.get(s.name)! } : s));
    for (const w of renameWarnings) process.stderr.write(`  ${c.yellow('⚠')}  ${w}\n`);
  }
  effectiveSlots = effectiveSlots.map((slot) => {
    if (!slot.allowedComponents) return slot;
    return { ...slot, allowedComponents: slot.allowedComponents.filter((name) => allowedComponentNames.has(name)) };
  });
  const cacheComponent = normalizeComponentForCache(component);

  if (!noCache && precomputedCachedNames.has(component.name)) {
    writeCachedComponentStatus(pos, component.name, false);
    return createCachedComponentResult(component.name);
  }

  if (!noCache) {
    const inputHash = computeComponentInputHash(cacheComponent);
    const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames);
    if (resolution && !resolution.humanEdited) {
      copyComponentFromCache(db, resolution.entry.sourceSessionId, sessionId, component.component_id, true, {
        allowedComponentNames,
      });
      storeCache(
        db,
        inputHash,
        'component',
        component.component_id,
        resolution.entry.sourceSessionId,
        resolution.entry.humanEdited,
        promptHash,
      );
      writeCachedComponentStatus(pos, component.name, false);
      return createCachedComponentResult(component.name);
    }
    if (resolution?.humanEdited) {
      copyComponentFromCache(db, resolution.entry.sourceSessionId, sessionId, component.component_id, true, {
        allowedComponentNames,
      });
      writeCachedComponentStatus(pos, component.name, true);
      return createCachedComponentResult(`${component.name}`, [
        `${component.name}: source changed but human edits preserved`,
      ]);
    }
  }

  const rawComponentsInline = JSON.stringify(
    [
      {
        name: component.name,
        source: component.source,
        framework: component.framework,
        props: component.props,
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
    const { result, output: outputBuf } = await invokeAgentWithOutput(
      invoker,
      { agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS },
      verbose,
    );
    const retryNote = attempt > 1 ? `  ${c.yellow(`retrying (${attempt}/${maxAttempts})`)}` : '';
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}${retryNote}\n${outputBuf}`);

    if (result.timedOut) {
      return {
        componentName: component.name,
        classified: 0,
        excluded: 0,
        slots: 0,
        warnings: [],
        failed: true,
        error: `timed out after ${DEFAULT_TIMEOUT_MS / 60000} minutes`,
        renamedSlotsCount: renames.length,
      };
    }
    if (result.exitCode !== 0) {
      lastError = describeAgentFailure(result);
      continue;
    }
    const { calls, warnings } = parseToolCallLines(result.stdout);
    if (calls.length === 0) {
      lastError = describeAgentFailure(result);
      continue;
    }
    const applied = applyToolCalls(db, sessionId, component.component_id, component.name, calls, warnings, {
      allowedComponentNames,
    });
    if (!noCache) {
      const inputHash = computeComponentInputHash(cacheComponent);
      storeCache(db, inputHash, 'component', component.component_id, sessionId, false, promptHash);
    }
    return {
      componentName: component.name,
      classified: applied.classified,
      excluded: applied.excluded,
      slots: applied.slots,
      warnings: applied.warnings,
      failed: false,
      renamedSlotsCount: renames.length,
    };
  }

  return {
    componentName: component.name,
    classified: 0,
    excluded: 0,
    slots: 0,
    warnings: [],
    failed: true,
    error: lastError,
    renamedSlotsCount: renames.length,
  };
}
