import { createElement } from 'react';
import { renderWithGoodbye } from '../tui/render-with-goodbye.js';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import {
  type AgentName,
  AGENT_NAMES,
  agentSupportsBedrock,
  createGenerateEndpoint,
  createLocalCliAgentInvoker,
  formatCustomPromptBanner,
  formatGenerateProgressLine,
  isAgentName,
  resolveBinary,
  resolveSkillPath,
  type PromptOptions,
  type Skill,
} from '@contentful/experience-design-system-generation';
import { c } from '../output/format.js';
import { getDebugLogger } from '../lib/debug-logger.js';
import { createAgentOutputCapture } from '../lib/agent-output.js';
import { GenerateView } from './tui/GenerateView.js';
import type { GenerateViewResult } from './tui/GenerateView.js';
import {
  openPipelineDb,
  loadRawComponents,
  loadComponentSourceRef,
  applyToolCalls,
  applyTokenToolCalls,
  computeComponentInputHash,
  computeTokenInputHash,
  lookupCache,
  lookupCacheByEntity,
  storeCache,
  storeCaches,
  copyComponentFromCache,
  copyComponentsFromCache,
  filterUnknownSlotAllowedComponents,
  findUnknownSlotAllowedComponents,
  copyTokensFromCache,
  renameEmptySlots,
  type RawComponentWithId,
} from '../session/db.js';
import { hashContent, hashPromptForSkill } from '../session/cache-keys.js';
import { readExistingContentfulEntitiesFromSession } from '../helpers/read-existing-contentful-entities-from-session.js';
import { summarizeForGenerateAgent, summarizeForMapTokens } from '../helpers/summarize-existing-contentful-entities.js';
import type { ExistingContentfulEntities } from '../helpers/fetch-existing-contentful-entities.js';
import { resolveExtractSessionId } from '../session/resolve-session-id.js';
import { getRefineArtifactsRoot, getRefineSessionPaths } from '../analyze/select/persistence.js';
import type { ReviewSessionSnapshot } from '../analyze/select/types.js';
import type { RawComponentDefinition } from '../types.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../analytics/index.js';
import { die, assertBinaryInPath } from '../lib/cli-errors.js';
import { pathExists } from '../lib/path-exists.js';
import { parsePromptOverrides, resolvePromptOverride } from '../lib/prompt-overrides.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);
const DEFAULT_COMPONENT_CONCURRENCY = 10;
const RETRY_BACKOFF_MS = Number(process.env.EDS_RETRY_BACKOFF_MS ?? 5_000);

interface GenerateSubcommandOptions {
  agent?: string;
  model?: string;
  bedrock?: boolean;
  session?: string;
  rawTokens?: string;
  tokens?: string;
  tokenMap?: string;
  dryRun?: boolean;
  verbose?: boolean;
  cache?: boolean;
  /** Feature 8: custom skill prompt path for `generate components`. */
  generatePromptPath?: string;
  prompt?: string[];
  /** Path to .existing-entities.json written after CMA credentials are supplied. */
  existingEntitiesPath?: string;
  cacheStatus?: boolean;
  restoreCache?: boolean;
  cachedComponents?: string;
}

const invoker = createLocalCliAgentInvoker({
  onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
});

async function assertFileExists(flag: string, p: string): Promise<void> {
  if (!(await pathExists(p))) die(`Error: file not found: ${p} (from ${flag})`);
}

async function readFileInline(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  const resolved = resolve(path);
  let s;
  try {
    s = await stat(resolved);
  } catch {
    return undefined;
  }
  if (!s.isDirectory()) return readFile(resolved, 'utf8');
  // Directory: collect and concatenate all JSON files
  const files: string[] = [];
  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      const full = join(dir, entry);
      let es;
      try {
        es = await stat(full);
      } catch {
        continue;
      }
      if (es.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith('.json')) {
        files.push(full);
      }
    }
  }
  await walk(resolved);
  if (files.length === 0) return undefined;
  const parts = await Promise.all(files.map((f) => readFile(f, 'utf8').catch(() => '')));
  return parts.filter(Boolean).join('\n\n');
}

function printFallbackInstructions(options: { agent: string; skill: Skill; sessionId: string }): void {
  const binary = resolveBinary(options.agent as AgentName);
  const skillPath = resolveSkillPath(options.skill);

  const lines = [
    `Error: agent '${options.agent}' not found in $PATH (looked for binary: ${binary}).`,
    `Install it or use one of: claude, codex, opencode, cursor`,
    ``,
    `To run the generation step manually:`,
    ``,
    `  1. Open your coding agent`,
    `  2. Run this skill (all input data will be embedded inline):`,
    `       ${skillPath}`,
    ``,
    `  Use --dry-run to print the full prompt including all inline data.`,
  ];

  lines.push(``, `  When done, the agent output must be stored in the session database.`);
  lines.push(`  Re-run the generate command with the agent available, or use --dry-run to inspect the prompt.`);

  process.stderr.write(lines.join('\n') + '\n');
}

interface ComponentRunResult {
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

interface ComponentRunOptions {
  agent: AgentName;
  model: string | undefined;
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

async function showGenerateView(result: GenerateViewResult): Promise<void> {
  if (process.stdout.isTTY) {
    const { waitUntilExit } = renderWithGoodbye(
      createElement(GenerateView, {
        result,
        onExit: () => void exitWithAnalytics(0),
      }),
    );
    await waitUntilExit();
    return;
  }

  process.stdout.write(
    `generate complete\nskill: ${result.skill}\nagent: ${result.agent}\nsession=${result.sessionId}\n`,
  );
  await exitWithAnalytics(0);
}

function normalizeComponentForCache(
  component: RawComponentDefinition & { component_id?: string },
): RawComponentDefinition & {
  component_id?: string;
} {
  const slots = component.slots.map((slot, index, allSlots) => ({
    ...slot,
    name: slot.name.trim() || (allSlots.length === 1 ? 'children' : `slot_${index}`),
  }));
  return { ...component, slots };
}

function lookupComponentCache(
  db: ReturnType<typeof openPipelineDb>,
  component: RawComponentDefinition & { component_id: string },
  promptHash: string,
): ReturnType<typeof lookupCache> {
  const normalized = normalizeComponentForCache(component);
  const inputHash = computeComponentInputHash(normalized);
  const cached = lookupCache(db, inputHash, 'component', component.component_id, promptHash);
  if (cached) return cached;

  // Read entries written before empty slot names were normalized. A successful
  // lookup is re-keyed below so the compatibility path is temporary.
  const legacyInputHash = computeComponentInputHash(component);
  return legacyInputHash === inputHash
    ? null
    : lookupCache(db, legacyInputHash, 'component', component.component_id, promptHash);
}

type ComponentCacheResolution = {
  entry: NonNullable<ReturnType<typeof lookupCache>>;
  humanEdited: boolean;
};

/** Resolve the reusable component definition with one shared precedence rule. */
function resolveComponentCache(
  db: ReturnType<typeof openPipelineDb>,
  component: RawComponentDefinition & { component_id: string },
  promptHash: string,
  allowedComponentNames: ReadonlySet<string>,
): ComponentCacheResolution | null {
  const cached = lookupComponentCache(db, component, promptHash);
  if (
    cached &&
    findUnknownSlotAllowedComponents(db, cached.sourceSessionId, allowedComponentNames, component.component_id)
      .length === 0
  ) {
    return { entry: cached, humanEdited: cached.humanEdited };
  }

  const pinned = lookupCacheByEntity(db, 'component', component.component_id);
  return pinned?.humanEdited &&
    findUnknownSlotAllowedComponents(db, pinned.sourceSessionId, allowedComponentNames, component.component_id)
      .length === 0
    ? { entry: pinned, humanEdited: true }
    : null;
}

async function runOneComponent(
  options: ComponentRunOptions,
  component: RawComponentDefinition & { component_id: string },
  index: number,
  total: number,
): Promise<ComponentRunResult> {
  const {
    agent,
    model,
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

  // Normalize empty slot names before deriving the cache key. The rename is
  // persisted in the session DB, so hashing the pre-rename component would
  // make the next run miss the cache forever for that component.
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
    return {
      ...slot,
      allowedComponents: slot.allowedComponents.filter((name) => allowedComponentNames.has(name)),
    };
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
  const promptOptions: PromptOptions & { skill: 'components' } = {
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
  };

  const endpoint = createGenerateEndpoint({ invoker });

  const maxAttempts = 2;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
    const outputCapture = createAgentOutputCapture(verbose);
    const response = await endpoint.execute({
      prompt: promptOptions,
      invocation: { agent, model, timeoutMs: DEFAULT_TIMEOUT_MS, onOutput: outputCapture.onOutput },
    });
    const outputBuf = outputCapture.finish();

    // Write header + all tool-call output as one block so concurrent workers don't interleave.
    const retryNote = attempt > 1 ? `  ${c.yellow(`retrying (${attempt}/${maxAttempts})`)}` : '';
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}${retryNote}\n${outputBuf}`);

    if (response.run.timedOut) {
      // Don't retry timeouts — same timeout will hit again
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

    if (response.failure) {
      lastError = response.failure;
      continue;
    }

    const applied = applyToolCalls(
      db,
      sessionId,
      component.component_id,
      component.name,
      response.calls,
      response.warnings,
      { allowedComponentNames },
    );
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

async function runAllComponents(
  options: ComponentRunOptions,
  components: Array<RawComponentDefinition & { component_id: string }>,
): Promise<ComponentRunResult[]> {
  const concurrency = Number(process.env.EDS_GENERATE_CONCURRENCY ?? DEFAULT_COMPONENT_CONCURRENCY);
  process.stderr.write(
    `Categorizing ${c.bold(String(components.length))} component${components.length === 1 ? '' : 's'}` +
      c.dim(`  (concurrency: ${concurrency})`) +
      '\n',
  );

  const results: ComponentRunResult[] = new Array(components.length);
  let next = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (next < components.length) {
      const i = next++;
      results[i] = await runOneComponent(options, components[i]!, i, components.length);
      completed += 1;
      process.stderr.write(`${formatGenerateProgressLine(completed, components.length, results[i]!.componentName)}\n`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, components.length) }, worker));
  return results;
}

async function resolveSessionId(sessionFlag: string | undefined): Promise<string> {
  return resolveExtractSessionId(sessionFlag, () => {
    void exitWithAnalytics(1);
    throw new Error('exit');
  });
}

async function loadAcceptedNames(sessionId: string): Promise<Set<string> | null> {
  try {
    const artifactsRoot = getRefineArtifactsRoot();
    const paths = await getRefineSessionPaths(sessionId, artifactsRoot);
    const raw = await readFile(paths.statePath, 'utf8');
    const snapshot = JSON.parse(raw) as ReviewSessionSnapshot;
    const accepted = snapshot.components.filter((c) => c.status === 'accepted').map((c) => c.name);
    if (accepted.length === 0) return null;
    return new Set(accepted);
  } catch {
    return null;
  }
}

function parsePrecomputedCachedNames(value: string | undefined): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

async function runGenerateSkill(skill: Skill, opts: GenerateSubcommandOptions, verbose = false): Promise<void> {
  const savedCreds = await readExperiencesCredentials();
  const agentName = opts.agent ?? savedCreds.agent;
  const model = opts.model ?? savedCreds.agentModel;
  if (!agentName || !isAgentName(agentName)) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: ${AGENT_NAMES.join(', ')}`,
    );
  }
  const agent = agentName;

  if (opts.bedrock && !agentSupportsBedrock(agent)) {
    die(`Error: --bedrock is not supported for --agent ${agent}`);
  }

  // Feature 8: resolve custom-prompt path for `components` (flag wins over
  // saved credentials), validate, and emit the warning banner once at action
  // entry.
  const configuredGeneratePromptPath =
    skill === 'components' ? (opts.generatePromptPath ?? savedCreds.generatePromptPath) : undefined;
  const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
  if (promptErrors.length > 0) die(`Error: ${promptErrors.join('; ')}`);
  let generatePrompt: string | undefined;
  const promptStage = skill === 'tokens' ? 'tokens' : 'generate';
  const generateOverride = promptOverrides.get(promptStage);
  if (generateOverride) {
    try {
      generatePrompt = await resolvePromptOverride(generateOverride);
    } catch (error) {
      die(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const generatePromptPath = generatePrompt === undefined ? configuredGeneratePromptPath : undefined;
  if (generatePromptPath) {
    if (!(await pathExists(resolve(generatePromptPath)))) {
      die(`Error: custom prompt path not found: ${resolve(generatePromptPath)}`);
    }
    if (!generatePromptPath.toLowerCase().endsWith('.md')) {
      process.stderr.write(
        `WARNING: custom prompt path does not end in .md (${generatePromptPath}) — proceeding anyway.\n`,
      );
    }
    process.stderr.write(formatCustomPromptBanner('components', resolve(generatePromptPath)));
  }

  if (skill === 'tokens' && !opts.rawTokens) {
    die('Error: --raw-tokens is required when using generate tokens');
  }

  if (opts.rawTokens) await assertFileExists('--raw-tokens', opts.rawTokens);
  if (opts.tokens) await assertFileExists('--tokens', opts.tokens);
  if (opts.tokenMap) await assertFileExists('--token-map', opts.tokenMap);

  // Read all token files inline so the agent never needs to read files itself
  const [rawTokensInline, tokensInline, tokenMapInline] = await Promise.all([
    readFileInline(opts.rawTokens),
    readFileInline(opts.tokens),
    readFileInline(opts.tokenMap),
  ]);

  // --existing-entities-path is optional enrichment written by the credential
  // fetch step. Load once here; each component derives its own component-summary
  // (fuzzy-matched likelyMatch), while the token summary is shared per run.
  let existingContentfulEntities: ExistingContentfulEntities | undefined;
  let existingTokensInline: string | undefined;
  if (opts.existingEntitiesPath) {
    existingContentfulEntities = await readExistingContentfulEntitiesFromSession(resolve(opts.existingEntitiesPath));
    if (existingContentfulEntities) {
      existingTokensInline = JSON.stringify(summarizeForMapTokens(existingContentfulEntities));
    } else {
      process.stderr.write(
        `warn: --existing-entities-path ${opts.existingEntitiesPath} could not be read as JSON — proceeding without space-context enrichment\n`,
      );
    }
  }

  // Load raw components from DB for the components skill
  let sessionId: string | undefined;
  let allComponents: RawComponentWithId[] | undefined;
  let allowedComponentNames: ReadonlySet<string> | undefined;
  if (skill === 'components') {
    sessionId = await resolveSessionId(opts.session);
    await bindAnalyticsSessionId(sessionId);
    const acceptedNames = await loadAcceptedNames(sessionId);
    const db = openPipelineDb();
    try {
      allComponents = loadRawComponents(db, sessionId, acceptedNames ?? undefined);
    } finally {
      db.close();
    }
    if (allComponents.length === 0) {
      die(`Error: session '${sessionId}' has no raw components. Run analyze extract first.`);
    }

    allowedComponentNames = new Set([
      ...allComponents.map((component) => component.name),
      ...(existingContentfulEntities?.components ?? []).map((component) => component.name),
    ]);
    if (!opts.dryRun) {
      const dbForReferences = openPipelineDb();
      try {
        const dropped = filterUnknownSlotAllowedComponents(dbForReferences, sessionId, allowedComponentNames);
        for (const reference of dropped) {
          process.stderr.write(
            `Warning: ${reference.componentName}: slot '${reference.slotName}' — dropped unknown allowed component '${reference.allowedComponent}'\n`,
          );
        }
        if (dropped.length > 0) {
          allComponents = loadRawComponents(dbForReferences, sessionId, acceptedNames ?? undefined);
        }
      } finally {
        dbForReferences.close();
      }
    }
    if (acceptedNames) {
      process.stderr.write(`Scope: ${allComponents.length} accepted component(s) from analyze select\n`);
    }

    // Warn about duplicate component names — later occurrences will overwrite earlier ones
    const nameCounts = new Map<string, string[]>();
    for (const c of allComponents) {
      const sources = nameCounts.get(c.name) ?? [];
      sources.push(c.source);
      nameCounts.set(c.name, sources);
    }
    const dupes = [...nameCounts.entries()].filter(([, srcs]) => srcs.length > 1);
    if (dupes.length > 0) {
      process.stderr.write(
        `Warning: ${dupes.length} duplicate component name(s) detected — only the last occurrence will be generated:\n`,
      );
      for (const [name, sources] of dupes) {
        process.stderr.write(`  ${name}:\n`);
        for (const src of sources) process.stderr.write(`    ${src}\n`);
      }
    }
  }

  if (opts.dryRun) {
    const sampleComponent = allComponents?.[0];
    const sampleInline = sampleComponent
      ? JSON.stringify(
          [
            {
              name: sampleComponent.name,
              source: sampleComponent.source,
              framework: sampleComponent.framework,
              props: sampleComponent.props,
              slots: sampleComponent.slots,
            },
          ],
          null,
          2,
        )
      : undefined;
    const sampleSourceRef = sampleComponent
      ? await loadComponentSourceRef(
          sampleComponent.name,
          sampleComponent.sourcePath ?? sampleComponent.source,
          sampleComponent.props.map((p) => p.name),
          sampleComponent.props.map((p) => p.type),
        )
      : undefined;
    const dryRunExistingComponentsInline =
      skill === 'components' && existingContentfulEntities && sampleComponent
        ? JSON.stringify(summarizeForGenerateAgent(existingContentfulEntities, sampleComponent.name))
        : undefined;
    const promptOptions: PromptOptions = {
      skill,
      mode: 'autonomous',
      rawComponentsInline: sampleInline ?? rawTokensInline,
      rawTokensInline: skill === 'tokens' ? rawTokensInline : undefined,
      rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
      tokensInline,
      tokenMapInline,
      outDir: process.cwd(),
      componentSourceRefs: sampleSourceRef ? [sampleSourceRef] : undefined,
      skillPathOverride: generatePromptPath,
      skillContentOverride: generatePrompt,
      existingComponentsInline: dryRunExistingComponentsInline,
      existingTokensInline: skill === 'components' ? existingTokensInline : undefined,
      componentAllowlistInline:
        skill === 'components' && allowedComponentNames ? JSON.stringify([...allowedComponentNames].sort()) : undefined,
    };
    const promptResponse = await createGenerateEndpoint({ invoker }).preview({ prompt: promptOptions });
    process.stdout.write(promptResponse.prompt + '\n');
    await exitWithAnalytics(0);
  }

  const binary = resolveBinary(agent);
  if (!(await assertBinaryInPath(binary))) {
    printFallbackInstructions({
      agent,
      skill,
      sessionId: sessionId ?? '',
    });
    await exitWithAnalytics(1);
  }

  if (skill === 'components' && allComponents && sessionId) {
    const db = openPipelineDb();
    let componentResults: ComponentRunResult[];
    const precomputedCachedNames = parsePrecomputedCachedNames(opts.cachedComponents);
    try {
      // Fold the existing-entities inputs (tokens summary + presence of entities)
      // into the prompt hash so cache entries invalidate when the target space
      // changes. Per-component fuzzy match derives from component name, which
      // is already part of computeComponentInputHash, so we don't need to fold
      // per-component summaries here.
      const existingContentfulEntitiesHashInputs: string[] = [];
      if (existingTokensInline) existingContentfulEntitiesHashInputs.push(hashContent(existingTokensInline));
      const promptHash = await hashPromptForSkill(
        'components',
        agent,
        model,
        generatePromptPath,
        existingContentfulEntitiesHashInputs,
        generatePrompt,
      );
      if (opts.cacheStatus) {
        const cacheEnabled = opts.cache !== false && process.env.EDS_NO_CACHE !== '1';
        const cachedComponents = cacheEnabled
          ? allComponents.flatMap((component) => {
              const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames!);
              return resolution ? [{ component, resolution }] : [];
            })
          : [];
        if (cacheEnabled && opts.restoreCache) {
          const restorations: Array<{
            sourceSessionId: string;
            targetSessionId: string;
            componentId: string;
          }> = [];
          const rekeyed: Array<{
            component: RawComponentWithId;
            cached: NonNullable<ReturnType<typeof lookupCache>>;
          }> = [];
          const componentStatus = db.prepare(
            'SELECT status FROM raw_components WHERE session_id = ? AND component_id = ?',
          );
          for (const { component, resolution } of cachedComponents) {
            const current = componentStatus.get(sessionId, component.component_id) as { status: string } | undefined;
            if (current?.status === 'generated') continue;
            renameEmptySlots(db, sessionId, component.component_id, component.name, component.slots.length);
            restorations.push({
              sourceSessionId: resolution.entry.sourceSessionId,
              targetSessionId: sessionId,
              componentId: component.component_id,
            });
            rekeyed.push({ component, cached: resolution.entry });
          }
          copyComponentsFromCache(db, restorations, { allowedComponentNames });
          storeCaches(
            db,
            rekeyed.map(({ component, cached }) => ({
              inputHash: computeComponentInputHash(normalizeComponentForCache(component)),
              entityType: 'component' as const,
              entityId: component.component_id,
              sourceSessionId: cached.sourceSessionId,
              humanEdited: cached.humanEdited,
              promptHash,
            })),
          );
        }
        const fullyCached = cacheEnabled && cachedComponents.length === allComponents.length;
        process.stdout.write(`cache-status=${fullyCached ? 'hit' : 'miss'}\n`);
        process.stdout.write(
          `cache-components=${JSON.stringify(cachedComponents.map(({ component }) => component.name))}\n`,
        );
        await exitWithAnalytics(0);
        return;
      }
      componentResults = await runAllComponents(
        {
          agent,
          model,
          db,
          sessionId,
          tokensInline,
          tokenMapInline,
          verbose,
          noCache: opts.cache === false || process.env.EDS_NO_CACHE === '1',
          skillPathOverride: generatePromptPath,
          skillContentOverride: generatePrompt,
          promptHash,
          existingContentfulEntities,
          existingTokensInline,
          precomputedCachedNames,
          allowedComponentNames: allowedComponentNames!,
        },
        allComponents,
      );
    } finally {
      db.close();
    }

    const failed = componentResults.filter((r) => r.failed);
    const cachedResults = componentResults.filter((r) => r.cached);
    const generated = componentResults.filter((r) => !r.failed && !r.cached);
    const allWarnings = componentResults.flatMap((r) => r.warnings.map((w) => `  ${r.componentName}: ${w}`));

    if (allWarnings.length > 0) {
      process.stderr.write(c.yellow('Warnings:') + '\n' + allWarnings.join('\n') + '\n');
    }
    if (failed.length > 0) {
      process.stderr.write(c.red(`Failed (${failed.length}/${componentResults.length}):`) + '\n');
      for (const f of failed) {
        process.stderr.write(`  ${c.red('✗')}  ${f.componentName}  ${c.dim(f.error ?? 'unknown error')}\n`);
      }
    }

    const totalClassified = generated.reduce((s, r) => s + r.classified, 0);
    const totalExcluded = generated.reduce((s, r) => s + r.excluded, 0);
    const totalRenamedSlots = componentResults.reduce((s, r) => s + r.renamedSlotsCount, 0);
    const allOk = failed.length === 0;
    const cachedNote = cachedResults.length > 0 ? c.dim(`  (${cachedResults.length} cached)`) : '';
    process.stderr.write(
      (allOk ? c.green('✓') : c.yellow('⚠')) +
        `  ${generated.length + cachedResults.length}/${componentResults.length} components` +
        cachedNote +
        c.dim(`  ${totalClassified} classified, ${totalExcluded} unattached`) +
        '\n',
    );
    // Machine-parseable summary on stdout for the wizard.
    process.stdout.write(`renamed-slots: ${totalRenamedSlots}\n`);

    if (generated.length === 0 && cachedResults.length === 0) {
      die(
        `Error: all ${componentResults.length} component(s) failed to generate — see the per-component errors above.`,
      );
    }
  } else if (skill === 'tokens') {
    const noCache = opts.cache === false || process.env.EDS_NO_CACHE === '1';
    const tokenInputContent = rawTokensInline ?? '';
    const tokenInputHash = computeTokenInputHash(tokenInputContent);

    const db = openPipelineDb();
    try {
      let resolvedSessionId = opts.session;
      if (!resolvedSessionId) {
        const s = db
          .prepare(
            `SELECT s.id FROM sessions s
           JOIN steps st ON st.session_id = s.id
           WHERE st.command = 'analyze extract' AND st.status = 'complete'
           ORDER BY st.started_at DESC LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        if (s) {
          resolvedSessionId = s.id;
        } else {
          const { generateSessionId } = await import('../session/session-id.js');
          const newId = generateSessionId();
          const now = new Date().toISOString();
          db.prepare('INSERT INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(
            newId,
            now,
            now,
          );
          resolvedSessionId = newId;
        }
      }

      sessionId = resolvedSessionId;
      await bindAnalyticsSessionId(resolvedSessionId);

      const tokenPromptHash = await hashPromptForSkill('tokens', agent, model);
      // Check cache before invoking agent
      if (!noCache) {
        const tokenCached = lookupCache(db, tokenInputHash, 'token_set', '__tokens__', tokenPromptHash);
        if (tokenCached) {
          copyTokensFromCache(db, tokenCached.sourceSessionId, resolvedSessionId);
          sessionId = resolvedSessionId;
          process.stderr.write(
            `Done: tokens reused from cache ${c.dim(`(source: ${tokenCached.sourceSessionId.slice(0, 12)})`)}\n`,
          );
          db.close();
          // Skip agent invocation — jump to view
          await showGenerateView({ skill, agent, sessionId: sessionId ?? '' });
          return;
        }
      }

      // Cache miss — invoke agent
      const endpoint = createGenerateEndpoint({ invoker });
      const response = await endpoint.execute({
        prompt: {
          skill,
          mode: 'autonomous',
          rawTokensInline,
          rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
          tokensInline,
          tokenMapInline,
          outDir: process.cwd(),
        },
        invocation: { agent, model, timeoutMs: DEFAULT_TIMEOUT_MS * 5 },
      });
      const result = response.run;

      if (result.timedOut) {
        die(`Error: agent did not complete within ${(DEFAULT_TIMEOUT_MS * 5) / 60000} minutes`);
      }
      if (result.exitCode !== 0) {
        if (result.stderr) process.stderr.write(result.stderr);
        die(`Error: agent exited with code ${result.exitCode}`);
      }

      const { calls: tokenCalls, warnings: tokenWarnings } = response;
      const tokenCount = tokenCalls.filter((tc) => tc.tool === 'set_token').length;

      if (tokenCount === 0) {
        process.stderr.write(
          `Error: agent produced no set_token calls.\n` +
            `Run with --dry-run to inspect the prompt.\n\n` +
            `Agent output:\n${result.stdout}\n`,
        );
        await exitWithAnalytics(1);
      }

      if (tokenWarnings.length > 0) {
        process.stderr.write(`Warnings:\n${tokenWarnings.map((w) => `  ${w}`).join('\n')}\n`);
      }

      applyTokenToolCalls(db, resolvedSessionId, tokenCalls, []);
      if (!noCache) {
        storeCache(db, tokenInputHash, 'token_set', '__tokens__', resolvedSessionId, false, tokenPromptHash);
      }
      sessionId = resolvedSessionId;

      const groupCount = tokenCalls.filter((tc) => tc.tool === 'set_group').length;
      process.stderr.write(`Done: ${tokenCount} tokens, ${groupCount} groups stored\n`);
    } finally {
      db.close();
    }
  }

  await showGenerateView({ skill, agent, sessionId: sessionId ?? '' });
}

function addAgentFlags(cmd: Command): Command {
  return addAgentModelOptions(cmd)
    .option('--verbose', 'Show full agent output including reasoning text')
    .option('--dry-run', 'Print the prompt without invoking the agent')
    .option(
      '--no-cache',
      'Bypass ALL fine-grained caches (extract, select, generate) and force AI re-run. ' +
        'Cache keys now factor in prompt content — changing the prompt file via --generate-prompt-path or ' +
        '--select-prompt-path will already bust the corresponding stage. Use --no-cache to force a full re-run.',
    );
}

export function registerInternalGenerateCommand(program: Command): void {
  const generate = program
    .command('__generate', { hidden: true })
    .description('Internal import pipeline generation command');

  // generate components subcommand
  const componentsCmd = generate
    .command('components')
    .description('Invoke a coding agent to produce components.json from raw analysis output')
    .option('--session <id>', 'Session ID from analyze extract (defaults to most recent)')
    .option('--tokens <path>', 'Path to tokens.json for token-linked prop resolution')
    .option('--token-map <path>', 'Path to token-name-map.json sidecar')
    .option(
      '--generate-prompt-path <path>',
      'Path to a custom .md skill prompt for components generation (bypasses bundled prompt invariants)',
    )
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). Used here for the generate stage.',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option(
      '--existing-entities-path <path>',
      'Path to the .existing-entities.json file written after CMA credentials are supplied. ' +
        'When present, per-component prompts include a summary of the target space so classifications can align to existing prop names/tokens. ' +
        'Missing/malformed files are treated as no-op.',
    );
  componentsCmd.option('--cache-status', 'Check whether all selected component definitions are cached');
  componentsCmd.option('--restore-cache', 'Restore cached component definitions into the current session');
  componentsCmd.option(
    '--cached-components <json>',
    'Component names already restored by a prior cache-status lookup; skip per-component cache lookup',
  );
  addAgentFlags(componentsCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateSkill('components', opts, opts.verbose ?? false);
  });

  // generate tokens subcommand
  const tokensCmd = generate
    .command('tokens')
    .description('Invoke a coding agent to produce tokens.json from raw token data')
    .option('--raw-tokens <path>', 'Path to raw token input file')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). Used here for the tokens stage.',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    );
  addAgentFlags(tokensCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateSkill('tokens', opts, opts.verbose ?? false);
  });
}
