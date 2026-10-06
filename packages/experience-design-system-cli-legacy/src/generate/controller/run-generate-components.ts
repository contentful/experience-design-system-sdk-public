import { resolve } from 'node:path';
import {
  buildPrompt,
  createLocalCliAgentInvoker,
  formatCustomPromptBanner,
} from '@contentful/experience-design-system-generation';
import {
  openPipelineDb,
  loadRawComponents,
  loadComponentSourceRef,
  computeComponentInputHash,
  lookupCache,
  storeCaches,
  copyComponentsFromCache,
  filterUnknownSlotAllowedComponents,
  renameEmptySlots,
} from '../../session/db.js';
import { hashContent, hashPromptForSkill } from '../../session/cache-keys.js';
import { readExistingContentfulEntitiesFromSession } from '../../helpers/read-existing-contentful-entities-from-session.js';
import {
  summarizeForGenerateAgent,
  summarizeForMapTokens,
} from '../../helpers/summarize-existing-contentful-entities.js';
import { resolveExtractSessionId } from '../../session/resolve-session-id.js';
import { bindAnalyticsSessionId, exitWithAnalytics } from '../../analytics/index.js';
import { die } from '../../lib/cli-errors.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import { pathExists } from '../../lib/path-exists.js';
import { getDebugLogger } from '../../lib/debug-logger.js';
import { c } from '../../output/format.js';
import { invokeAllComponentAgents } from '../services/invoke-all-component-agents.js';
import { normalizeComponentForCache } from '../helpers/normalize-component-for-cache.js';
import { resolveComponentCache } from '../services/resolve-component-cache.js';
import { readFileInline } from '../helpers/read-file-inline.js';
import { assertFileExists } from '../helpers/assert-file-exists.js';
import { parsePrecomputedCachedNames } from '../helpers/parse-precomputed-cached-names.js';
import { loadAcceptedNames } from '../services/load-accepted-names.js';
import { verifyAgentBinary } from '../services/verify-agent-binary.js';
import { resolveGenerateAgent } from '../services/resolve-generate-agent.js';
import { showGenerateView } from '../services/show-generate-view.js';
import type { GenerateSubcommandOptions } from '../command.js';

export async function runGenerateComponents(opts: GenerateSubcommandOptions, verbose: boolean): Promise<void> {
  const { agent, model, savedCreds } = await resolveGenerateAgent(opts);

  const configuredGeneratePromptPath = opts.generatePromptPath ?? savedCreds.generatePromptPath;
  const { overrides: promptOverrides, errors: promptErrors } = parsePromptOverrides(opts.prompt ?? []);
  if (promptErrors.length > 0) die(`Error: ${promptErrors.join('; ')}`);
  let generatePrompt: string | undefined;
  const generateOverride = promptOverrides.get('generate');
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

  if (opts.tokens) await assertFileExists('--tokens', opts.tokens);
  if (opts.tokenMap) await assertFileExists('--token-map', opts.tokenMap);

  const [tokensInline, tokenMapInline] = await Promise.all([
    readFileInline(opts.tokens),
    readFileInline(opts.tokenMap),
  ]);

  let existingContentfulEntities = undefined;
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

  const sessionId = await resolveExtractSessionId(opts.session, () => {
    void exitWithAnalytics(1);
    throw new Error('exit');
  });
  await bindAnalyticsSessionId(sessionId);
  const acceptedNames = await loadAcceptedNames(sessionId);

  let allComponents;
  {
    const db = openPipelineDb();
    try {
      allComponents = loadRawComponents(db, sessionId, acceptedNames ?? undefined);
    } finally {
      db.close();
    }
  }

  if (allComponents.length === 0) {
    die(`Error: session '${sessionId}' has no raw components. Run analyze extract first.`);
  }

  const allowedComponentNames: ReadonlySet<string> = new Set([
    ...allComponents.map((c) => c.name),
    ...(existingContentfulEntities?.components ?? []).map((c) => c.name),
  ]);

  if (!opts.dryRun) {
    const db = openPipelineDb();
    try {
      const dropped = filterUnknownSlotAllowedComponents(db, sessionId, allowedComponentNames);
      for (const reference of dropped) {
        process.stderr.write(
          `Warning: ${reference.componentName}: slot '${reference.slotName}' — dropped unknown allowed component '${reference.allowedComponent}'\n`,
        );
      }
      if (dropped.length > 0) {
        allComponents = loadRawComponents(db, sessionId, acceptedNames ?? undefined);
      }
    } finally {
      db.close();
    }
  }

  if (acceptedNames) {
    process.stderr.write(`Scope: ${allComponents.length} accepted component(s) from analyze select\n`);
  }

  const nameCounts = new Map<string, string[]>();
  for (const component of allComponents) {
    const sources = nameCounts.get(component.name) ?? [];
    sources.push(component.source);
    nameCounts.set(component.name, sources);
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

  if (opts.dryRun) {
    const sampleComponent = allComponents[0];
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
      existingContentfulEntities && sampleComponent
        ? JSON.stringify(summarizeForGenerateAgent(existingContentfulEntities, sampleComponent.name))
        : undefined;
    const prompt = await buildPrompt({
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: sampleInline,
      tokensInline,
      tokenMapInline,
      outDir: process.cwd(),
      componentSourceRefs: sampleSourceRef ? [sampleSourceRef] : undefined,
      skillPathOverride: generatePromptPath,
      skillContentOverride: generatePrompt,
      existingComponentsInline: dryRunExistingComponentsInline,
      existingTokensInline,
      componentAllowlistInline: JSON.stringify([...allowedComponentNames].sort()),
    });
    process.stdout.write(prompt + '\n');
    await exitWithAnalytics(0);
    return;
  }

  if (!(await verifyAgentBinary(agent, 'components', sessionId))) return;

  const invoker = createLocalCliAgentInvoker({
    onDebugEvent: (name, payload) => getDebugLogger().event('agent', name, payload),
  });

  const db = openPipelineDb();
  let componentResults;
  const precomputedCachedNames = parsePrecomputedCachedNames(opts.cachedComponents);
  try {
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
            const resolution = resolveComponentCache(db, component, promptHash, allowedComponentNames);
            return resolution ? [{ component, resolution }] : [];
          })
        : [];
      if (cacheEnabled && opts.restoreCache) {
        const restorations: Array<{ sourceSessionId: string; targetSessionId: string; componentId: string }> = [];
        const rekeyed: Array<{
          component: (typeof allComponents)[0];
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

    componentResults = await invokeAllComponentAgents(
      {
        agent,
        model,
        invoker,
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
        allowedComponentNames,
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

  if (allWarnings.length > 0) process.stderr.write(c.yellow('Warnings:') + '\n' + allWarnings.join('\n') + '\n');
  if (failed.length > 0) {
    process.stderr.write(c.red(`Failed (${failed.length}/${componentResults.length}):`) + '\n');
    for (const f of failed)
      process.stderr.write(`  ${c.red('✗')}  ${f.componentName}  ${c.dim(f.error ?? 'unknown error')}\n`);
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
  process.stdout.write(`renamed-slots: ${totalRenamedSlots}\n`);

  if (generated.length === 0 && cachedResults.length === 0) {
    die(`Error: all ${componentResults.length} component(s) failed to generate — see the per-component errors above.`);
  }

  await showGenerateView({ skill: 'components', agent, sessionId });
}
