import React, { createElement } from 'react';
import { render } from 'ink';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  validateCDF,
  flattenDTCG,
  validateDTCG,
  buildManifest,
  validateManifestSlotReferences,
} from '@contentful/experience-design-system-types';
import type { CDFComponentEntry, CDFValidationError, DTCGTokenEntry } from '@contentful/experience-design-system-types';
import { ApiError, ImportApiClient } from './api-client.js';
import { formatApiError, formatEdsiError } from '../lib/error-parser.js';
import { openPipelineDb, loadCDFComponents } from '../session/db.js';
import { findSlotCycles, suggestCycleBreakEdge, formatCyclePath } from '../analyze/cycle-detection.js';
import type { ServerPreviewResponse, ApplyOperationResponse } from '@contentful/experience-design-system-types';
import { isEmptyPreview } from './preview-utils.js';
import { ServerPreviewApp, ServerPreviewConfirm, ServerApplyProgress, ServerApplyDone } from './tui/ServerApplyView.js';
import { buildPostPushUrl } from '../lib/contentful-urls.js';
import { resolveCompositionMode, type CompositionMode } from '../lib/composition-mode.js';
import { addArtifactInputOptions, addCompositionOptions, addContentfulTargetOptions } from '../lib/command-options.js';
import { stripAllowedComponents } from '../import/strip-allowed-components.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { getInteractiveTerminalSupport } from '../lib/terminal-capabilities.js';
import {
  bindAnalyticsSessionId,
  exitWithAnalytics,
  failureFromApiError,
  recordApplyOutcome,
  recordContentfulContext,
} from '../analytics/index.js';
import type { CommandFailure } from '../analytics/index.js';
import { pathExists } from '../lib/path-exists.js';

async function die(message: string, fields: CommandFailure = {}): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1, fields);
}

function dieWithApiError(error: ApiError, verbose?: boolean): Promise<never> {
  return die(`Error: ${formatApiError(error, verbose)}`, failureFromApiError(error));
}

async function assertFileExists(flag: string, p: string): Promise<void> {
  if (!(await pathExists(p))) return await die(`Error: file not found: ${p} (from ${flag})`);
}

async function readJsonFile(flag: string, p: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(p, 'utf8');
  } catch {
    return await die(`Error: file not found: ${p} (from ${flag})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return await die(`Error: ${flag} is not valid JSON: ${p}`);
  }
}

const IGNORE_TOKEN_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.git']);

async function collectJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (IGNORE_TOKEN_DIRS.has(entry)) return;
        const full = join(current, entry);
        let s;
        try {
          s = await stat(full);
        } catch {
          return;
        }
        if (s.isDirectory()) {
          await walk(full);
        } else if (entry.endsWith('.json')) {
          results.push(full);
        }
      }),
    );
  }
  await walk(dir);
  return results;
}

export async function readTokensFromPath(flag: string, p: string): Promise<DTCGTokenEntry[]> {
  let s;
  try {
    s = await stat(p);
  } catch {
    return await die(`Error: file not found: ${p} (from ${flag})`);
  }
  if (s.isDirectory()) {
    const files = await collectJsonFiles(p);
    if (files.length === 0) return await die(`Error: no .json files found in directory: ${p} (from ${flag})`);
    const merged: Record<string, unknown> = {};
    for (const file of files.sort()) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(merged, parsed as Record<string, unknown>);
      }
    }
    const { valid, errors } = validateDTCG(merged);
    if (!valid)
      return await die(
        `Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      );
    return flattenDTCG(merged, '');
  }
  const raw = await readJsonFile(flag, p);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return await die(`Error: ${flag} is not valid JSON: expected an object`);
  }
  const { valid, errors } = validateDTCG(raw as Record<string, unknown>);
  if (!valid)
    return await die(
      `Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  return flattenDTCG(raw as Record<string, unknown>, '');
}

interface SharedImportOptions {
  components?: string;
  tokens?: string;
  session?: string;
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  composite?: boolean;
  atomic?: boolean;
}

interface ApplyOptions extends SharedImportOptions {
  yes?: boolean;
  verbose?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

type SharedInputs = Awaited<ReturnType<typeof resolveSharedInputs>>;

function addSharedApplyOptions(command: Command): void {
  addArtifactInputOptions(command);
  addContentfulTargetOptions(command);
  addCompositionOptions(command).option(
    '--atomic',
    'Import flat components with no embedded-component hierarchy (default)',
  );
}

async function resolveSharedInputsOrDie(opts: SharedImportOptions, verbose?: boolean): Promise<SharedInputs> {
  try {
    return await resolveSharedInputs(opts);
  } catch (e) {
    if (e instanceof ApiError) return await dieWithApiError(e, verbose);
    throw e;
  }
}

type ApplyProgressStatus = 'applying' | 'polling' | 'error';

function renderApplyProgress(
  rerender: (element: React.ReactElement) => void,
  spaceId: string,
  environmentId: string,
  status: ApplyProgressStatus,
  details: { operationId?: string; error?: string } = {},
): void {
  rerender(
    createElement(ServerApplyProgress, {
      spaceId,
      environmentId,
      status,
      ...details,
    }),
  );
}

interface ApplyAndPollOptions {
  acknowledgeBreakingChanges: boolean;
  onProgress?: (status: 'applying' | 'polling', operationId?: string) => void;
  onStarted?: (operationId: string) => void;
  onApiError: (error: ApiError) => Promise<void> | void;
}

function createApplyProgressHandlers(
  rerender: (element: React.ReactElement) => void,
  spaceId: string,
  environmentId: string,
  formatError: (error: ApiError) => string,
): Pick<ApplyAndPollOptions, 'onProgress' | 'onApiError'> {
  return {
    onProgress: (status, operationId) => {
      renderApplyProgress(rerender, spaceId, environmentId, status, { operationId });
    },
    onApiError: (error) => {
      renderApplyProgress(rerender, spaceId, environmentId, 'error', { error: formatError(error) });
    },
  };
}

async function applyAndPoll(
  client: ImportApiClient,
  manifest: Parameters<ImportApiClient['applyImport']>[0],
  options: ApplyAndPollOptions,
): Promise<ApplyOperationResponse | null> {
  options.onProgress?.('applying');

  let operation: ApplyOperationResponse;
  try {
    operation = await client.applyImport(manifest, {
      acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    });
  } catch (e) {
    if (e instanceof ApiError) {
      await options.onApiError(e);
      return null;
    }
    throw e;
  }

  options.onStarted?.(operation.sys.id);
  options.onProgress?.('polling', operation.sys.id);

  try {
    operation = await client.pollOperation(operation.sys.id);
  } catch (e) {
    if (e instanceof ApiError) {
      await options.onApiError(e);
      return null;
    }
    throw e;
  }

  return operation;
}

interface NonInteractiveApplyOptions {
  client: ImportApiClient;
  manifest: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
  verbose?: boolean;
}

async function runNonInteractiveApply(options: NonInteractiveApplyOptions): Promise<void> {
  const operation = await applyAndPoll(options.client, options.manifest, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    onStarted: (operationId) => {
      process.stderr.write(`Apply operation started: ${operationId}\n`);
    },
    onApiError: (error) => dieWithApiError(error, options.verbose),
  });
  if (!operation) return;

  const summary = buildApplyOutput(operation, options.spaceId, options.environmentId, options.host);
  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation);
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  await exitWithAnalytics(operation.sys.status === 'succeeded' ? 0 : 1);
}

interface InteractiveApplyOptions {
  client: ImportApiClient;
  manifest: Parameters<ImportApiClient['applyImport']>[0];
  spaceId: string;
  environmentId: string;
  host?: string;
  acknowledgeBreakingChanges: boolean;
  verbose?: boolean;
  rerender: (element: React.ReactElement) => void;
  onDone: () => void;
}

async function runInteractiveApply(options: InteractiveApplyOptions): Promise<void> {
  const operation = await applyAndPoll(options.client, options.manifest, {
    acknowledgeBreakingChanges: options.acknowledgeBreakingChanges,
    ...createApplyProgressHandlers(options.rerender, options.spaceId, options.environmentId, (error) =>
      formatApiError(error, options.verbose),
    ),
  });
  if (!operation) return;

  recordApplyOutcome(options.client, options.spaceId, options.environmentId, operation);
  options.rerender(
    createElement(ServerApplyDone, {
      operation,
      spaceId: options.spaceId,
      environmentId: options.environmentId,
      host: options.host,
    }),
  );
  options.onDone();
}

async function resolveSharedInputs(opts: SharedImportOptions): Promise<{
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: DTCGTokenEntry[];
  client: ImportApiClient;
}> {
  if (!opts.components && !opts.tokens && !opts.session) {
    return await die('Error: at least one of --components, --tokens, or --session is required');
  }

  if (opts.session && opts.components) {
    return await die('Error: --session and --components are mutually exclusive');
  }

  const spaceId = opts.spaceId ?? process.env.CONTENTFUL_SPACE_ID;
  const environmentId = opts.environmentId ?? process.env.CONTENTFUL_ENVIRONMENT_ID;
  if (!spaceId) return await die('Error: --space-id is required (or set CONTENTFUL_SPACE_ID)');
  if (!environmentId) return await die('Error: --environment-id is required (or set CONTENTFUL_ENVIRONMENT_ID)');
  opts.spaceId = spaceId;
  opts.environmentId = environmentId;

  const cmaToken = opts.cmaToken ?? process.env.CONTENTFUL_MANAGEMENT_TOKEN;
  if (!cmaToken) {
    return await die('Error: CMA token is required. Pass --cma-token or set CONTENTFUL_MANAGEMENT_TOKEN');
  }

  if (opts.components) await assertFileExists('--components', opts.components);

  let components: Array<{ key: string; entry: CDFComponentEntry }> = [];
  if (opts.session) {
    const db = openPipelineDb();
    try {
      components = loadCDFComponents(db, opts.session);
    } finally {
      db.close();
    }
    if (components.length === 0) {
      return await die(`Error: session '${opts.session}' has no generated components. Run generate components first.`);
    }
  } else if (opts.components) {
    const raw = await readJsonFile('--components', opts.components);
    const result = validateCDF(raw);
    if (!result.valid) {
      return await die(
        `Error: --components failed schema validation: ${result.errors.map((e) => e.message).join(', ')}`,
      );
    }
    components = result.components;
  }

  // Atomic mode (spec T8/T12): strip embedded-component composition at the
  // single serialization boundary, regardless of load path. Normalizing here
  // (rather than only in loadCDFComponents) also covers hand-authored
  // `--components` files. Starving `$allowedComponents` at this one point
  // means slot-cycle detection downstream structurally returns zero.
  let configMode: CompositionMode | undefined;
  try {
    configMode = (await readExperiencesCredentials()).compositionMode;
  } catch {
    // Missing credentials.json → resolver falls through to default (atomic).
  }
  if (resolveCompositionMode(opts, configMode) === 'atomic') {
    components = stripAllowedComponents(components);
  }

  let tokens: DTCGTokenEntry[] = [];
  if (opts.tokens) {
    tokens = await readTokensFromPath('--tokens', opts.tokens);
  }

  const client = new ImportApiClient({
    host: opts.host,
    cmaToken,
    spaceId,
    environmentId,
  });

  return { components, tokens, client };
}

export function detectSlotCycles(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): ReturnType<typeof findSlotCycles> {
  const cycleInput = components.map(({ key, entry }) => ({
    name: key,
    slots: Object.entries(entry.$slots ?? {}).map(([slotName, slotDef]) => ({
      name: slotName,
      allowedComponents: slotDef.$allowedComponents ?? [],
    })),
  }));
  return findSlotCycles(cycleInput);
}

export function formatSlotCycleReport(cycles: ReturnType<typeof findSlotCycles>): string[] {
  const lines: string[] = [];
  lines.push(
    `Error: manifest:components/slot-cycles — ${cycles.length} slot dependency cycle(s) detected. Push refused.`,
  );
  for (let i = 0; i < cycles.length; i += 1) {
    const cycle = cycles[i];
    lines.push(`  Cycle ${i + 1}: ${formatCyclePath(cycle)}`);
    const suggested = suggestCycleBreakEdge(cycle, cycles);
    lines.push(
      `    Fix: remove '${suggested.toComponent}' from ${suggested.fromComponent}.$slots.${suggested.slotName}.$allowedComponents`,
    );
  }
  return lines;
}

export async function assertNoSlotCycles(components: Array<{ key: string; entry: CDFComponentEntry }>): Promise<void> {
  const cycles = detectSlotCycles(components);
  if (cycles.length === 0) return;
  process.stderr.write(formatSlotCycleReport(cycles).join('\n') + '\n');
  await exitWithAnalytics(1);
}

/**
 * Client-side pre-flight for `$allowedComponents` references that are absent
 * from this manifest, so a typo'd or renamed reference fails fast instead of
 * waiting on the `previewImport`/`applyImport` round-trip. Only catches
 * manifest-internal misses — a name that resolves against an *existing*
 * target-environment Component still needs the network round-trip to
 * confirm, so this cannot replace the server-side check.
 *
 * `validateManifestSlotReferences` is the detection step (shared with
 * `WizardApp.tsx` via `formatUnresolvedSlotReferences` below, mirroring how
 * `detectSlotCycles`/`formatSlotCycleReport` split for the cycle check).
 */
export function formatUnresolvedSlotReferences(errors: CDFValidationError[]): string[] {
  const lines = ['Error: manifest slot $allowedComponents references failed to resolve locally. Push refused.'];
  for (const error of errors) {
    lines.push(`  - ${error.message} (${error.path})`);
  }
  return lines;
}

export async function assertNoUnresolvedSlotReferences(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): Promise<void> {
  const errors = validateManifestSlotReferences(components);
  if (errors.length === 0) return;
  process.stderr.write(formatUnresolvedSlotReferences(errors).join('\n') + '\n');
  await exitWithAnalytics(1);
}

export function extractComponentsFromManifest(
  manifest: { componentsManifest?: Record<string, unknown> } | null | undefined,
): Array<{ key: string; entry: CDFComponentEntry }> {
  const componentsManifest = manifest?.componentsManifest;
  if (!componentsManifest) return [];
  const out: Array<{ key: string; entry: CDFComponentEntry }> = [];
  for (const [key, value] of Object.entries(componentsManifest)) {
    if (key === '$schema') continue;
    if (!value || typeof value !== 'object') continue;
    out.push({ key, entry: value as CDFComponentEntry });
  }
  return out;
}

export function hasBreakingChangesWithImpact(preview: ServerPreviewResponse): boolean {
  const allChanged = [...preview.components.changed, ...preview.tokens.changed];
  return allChanged.some(
    (c) =>
      c.changeClassification?.classification === 'breaking' &&
      c.impact &&
      (c.impact.affectedFragments > 0 || c.impact.affectedExperiences > 0),
  );
}

function buildPreviewOutput(preview: ServerPreviewResponse, spaceId: string, environmentId: string) {
  return {
    spaceId,
    environmentId,
    components: {
      new: preview.components.new.length,
      changed: preview.components.changed.length,
      unchanged: preview.components.unchanged.length,
      removed: preview.components.removed.length,
      breaking: preview.components.changed.filter((c) => c.changeClassification?.classification === 'breaking').length,
      draftOverwrites: preview.components.changed.filter((c) => c.hasPendingDraftChanges).length,
    },
    tokens: {
      new: preview.tokens.new.length,
      changed: preview.tokens.changed.length,
      unchanged: preview.tokens.unchanged.length,
      removed: preview.tokens.removed.length,
      draftOverwrites: preview.tokens.changed.filter((c) => c.hasPendingDraftChanges).length,
    },
    taxonomies: {
      new: preview.taxonomies.new.length,
      changed: preview.taxonomies.changed.length,
      unchanged: preview.taxonomies.unchanged.length,
      removed: preview.taxonomies.removed.length,
    },
  };
}

function buildApplyOutput(
  operation: ApplyOperationResponse,
  spaceId: string,
  environmentId: string,
  host: string | undefined,
) {
  const items = operation.items ?? [];
  const componentItems = items.filter((i) => i.entityType === 'ComponentType');
  const tokenItems = items.filter((i) => i.entityType === 'DesignToken');

  function countByAction(subset: typeof items) {
    return {
      created: subset.filter((i) => i.action === 'create' && i.status === 'succeeded').length,
      updated: subset.filter((i) => i.action === 'update' && i.status === 'succeeded').length,
      failed: subset.filter((i) => i.status === 'failed').length,
    };
  }

  return {
    status: operation.sys.status,
    operationId: operation.sys.id,
    spaceId,
    environmentId,
    summary: operation.summary,
    componentTypes: countByAction(componentItems),
    designTokens: countByAction(tokenItems),
    viewUrl: buildPostPushUrl({ host: host ?? 'api.contentful.com', spaceId, environmentId }),
    tokensUrl: buildPostPushUrl({ host: host ?? 'api.contentful.com', spaceId, environmentId, view: 'design_tokens' }),
    failures: items
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        entityType: item.entityType,
        entityId: item.id,
        error: formatEdsiError(item.error),
      })),
  };
}

export function registerApplyCommand(program: Command): void {
  const applyCmd = program.command('apply').description('Preview or push design system entities to Contentful ExO');

  const pushCmd = applyCmd.command('push').description('Write component types and design tokens to Contentful ExO');
  addSharedApplyOptions(pushCmd);
  pushCmd
    .option('--yes', 'Skip interactive confirmation')
    .option('--verbose', 'Show all entity progress including skipped/unchanged')
    .option('--force', 'Skip confirmation for breaking changes (for CI)')
    .option('--dry-run', 'Run preview only without applying')
    .action(async (opts: ApplyOptions) => {
      const isTTY = getInteractiveTerminalSupport().supported;

      if (!isTTY && !opts.yes) {
        process.stderr.write('Error: apply push requires --yes in non-interactive mode\n');
        await exitWithAnalytics(1);
      }

      const inputs = await resolveSharedInputsOrDie(opts, opts.verbose);

      const { components, tokens, client } = inputs;
      const spaceId = opts.spaceId!;
      const environmentId = opts.environmentId!;
      await bindAnalyticsSessionId(opts.session, {
        space_key: spaceId,
        environment_key: environmentId,
      });

      await assertNoSlotCycles(components);
      await assertNoUnresolvedSlotReferences(components);

      try {
        await client.validateToken();
      } catch (e) {
        if (e instanceof ApiError)
          return await die(`Error: ${formatApiError(e, opts.verbose)}`, failureFromApiError(e));
        throw e;
      }

      const manifest = buildManifest(components, tokens);

      let preview: ServerPreviewResponse;
      try {
        preview = await client.previewImport(manifest);
      } catch (e) {
        if (e instanceof ApiError)
          return await die(`Error: ${formatApiError(e, opts.verbose)}`, failureFromApiError(e));
        throw e;
      }

      recordContentfulContext(client, spaceId, environmentId);

      if (opts.dryRun) {
        if (isTTY) {
          const { waitUntilExit } = render(
            createElement(ServerPreviewApp, {
              preview,
              spaceId,
              environmentId,
            }),
          );
          await waitUntilExit();
        } else {
          process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
        }
        await exitWithAnalytics(0);
      }

      if (isEmptyPreview(preview)) {
        if (isTTY && !opts.yes) {
          process.stderr.write('Nothing to change — design system is up to date.\n');
        } else {
          process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
        }
        await exitWithAnalytics(0);
      }

      const breakingWithImpact = hasBreakingChangesWithImpact(preview);

      if (!isTTY || opts.yes) {
        if (breakingWithImpact && !opts.force) {
          process.stderr.write(
            'Error: breaking changes with downstream impact detected. Use --force to acknowledge.\n',
          );
          process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
          await exitWithAnalytics(1);
        }

        const verbose = opts.verbose ?? false;
        if (verbose) {
          process.stderr.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
        }

        await runNonInteractiveApply({
          client,
          manifest,
          spaceId,
          environmentId,
          acknowledgeBreakingChanges: breakingWithImpact || opts.force === true,
          host: opts.host,
          verbose: opts.verbose,
        });
        return;
      }

      await new Promise<void>((resolvePromise) => {
        const runApply = async (acknowledge: boolean) => {
          await runInteractiveApply({
            client,
            manifest,
            spaceId,
            environmentId,
            host: opts.host,
            acknowledgeBreakingChanges: acknowledge,
            verbose: opts.verbose,
            rerender: (element) => instance.rerender(element),
            onDone: resolvePromise,
          });
        };

        const instance = render(
          createElement(ServerPreviewConfirm, {
            preview,
            spaceId,
            environmentId,
            breakingWithImpact,
            onConfirm: (acknowledge: boolean) => {
              void runApply(acknowledge);
            },
            onCancel: () => {
              void exitWithAnalytics(0);
            },
          }),
        );

        void instance.waitUntilExit().then(() => resolvePromise());
      });
    });
}
