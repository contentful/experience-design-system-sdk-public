import React, { createElement, useState } from 'react';
import { render, useInput } from 'ink';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Command } from 'commander';
import {
  validateCDF,
  flattenDTCG,
  validateDTCG,
  buildManifest,
  buildFilteredManifest,
} from '@contentful/experience-design-system-types';
import type { CDFComponentEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';
import { ApiError, ImportApiClient } from './api-client.js';
import { openPipelineDb, loadCDFComponents } from '../session/db.js';
import type { ServerPreviewResponse, ApplyOperationResponse } from '@contentful/experience-design-system-types';
import { ServerPreviewApp, ServerPreviewConfirm, ServerApplyProgress, ServerApplyDone } from './tui/ServerApplyView.js';
import { SelectView, makeSelectKey, type SelectableEntity } from './tui/SelectView.js';

function die(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function pathExists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

async function assertFileExists(flag: string, p: string): Promise<void> {
  if (!(await pathExists(p))) die(`Error: file not found: ${p} (from ${flag})`);
}

async function readJsonFile(flag: string, p: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(p, 'utf8');
  } catch {
    die(`Error: file not found: ${p} (from ${flag})`);
  }
  try {
    return JSON.parse(text!);
  } catch {
    die(`Error: ${flag} is not valid JSON: ${p}`);
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
    die(`Error: file not found: ${p} (from ${flag})`);
  }
  if (s!.isDirectory()) {
    const files = await collectJsonFiles(p);
    if (files.length === 0) die(`Error: no .json files found in directory: ${p} (from ${flag})`);
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
      die(`Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
    return flattenDTCG(merged, '');
  }
  const raw = await readJsonFile(flag, p);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    die(`Error: ${flag} is not valid JSON: expected an object`);
  }
  const { valid, errors } = validateDTCG(raw as Record<string, unknown>);
  if (!valid)
    die(`Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
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
}

interface PreviewOptions extends SharedImportOptions {
  includeUnchanged?: boolean;
}

interface ApplyOptions extends SharedImportOptions {
  yes?: boolean;
  verbose?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

interface SelectOptions extends SharedImportOptions {
  selectAll?: boolean;
  select?: string[];
  deselect?: string[];
  force?: boolean;
}

async function resolveSharedInputs(opts: SharedImportOptions): Promise<{
  components: Array<{ key: string; entry: CDFComponentEntry }>;
  tokens: DTCGTokenEntry[];
  client: ImportApiClient;
}> {
  if (!opts.components && !opts.tokens && !opts.session) {
    die('Error: at least one of --components, --tokens, or --session is required');
  }

  if (opts.session && opts.components) {
    die('Error: --session and --components are mutually exclusive');
  }

  const spaceId = opts.spaceId ?? process.env.CONTENTFUL_SPACE_ID;
  const environmentId = opts.environmentId ?? process.env.CONTENTFUL_ENVIRONMENT_ID;
  if (!spaceId) die('Error: --space-id is required (or set CONTENTFUL_SPACE_ID)');
  if (!environmentId) die('Error: --environment-id is required (or set CONTENTFUL_ENVIRONMENT_ID)');
  opts.spaceId = spaceId;
  opts.environmentId = environmentId;

  const cmaToken = opts.cmaToken ?? process.env.CONTENTFUL_MANAGEMENT_TOKEN;
  if (!cmaToken) {
    die('Error: CMA token is required. Pass --cma-token or set CONTENTFUL_MANAGEMENT_TOKEN');
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
      die(`Error: session '${opts.session}' has no generated components. Run generate components first.`);
    }
  } else if (opts.components) {
    const raw = await readJsonFile('--components', opts.components);
    const result = validateCDF(raw);
    if (!result.valid) {
      die(`Error: --components failed schema validation: ${result.errors.map((e) => e.message).join(', ')}`);
    }
    components = result.components;
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

// --- Output helpers ---

function isEmptyPreview(preview: ServerPreviewResponse): boolean {
  const { components, tokens, taxonomies } = preview;
  return (
    components.new.length === 0 &&
    components.changed.length === 0 &&
    components.removed.length === 0 &&
    tokens.new.length === 0 &&
    tokens.changed.length === 0 &&
    tokens.removed.length === 0 &&
    taxonomies.new.length === 0 &&
    taxonomies.changed.length === 0 &&
    taxonomies.removed.length === 0
  );
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

function buildApplyOutput(operation: ApplyOperationResponse, spaceId: string, environmentId: string) {
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
    failures: items
      .filter((item) => item.status === 'failed')
      .map((item) => ({
        entityType: item.entityType,
        entityId: item.id,
        error: item.error,
      })),
  };
}

// --- Selection helpers ---

function getSelectableEntities(preview: ServerPreviewResponse): SelectableEntity[] {
  const entities: SelectableEntity[] = [];

  for (const token of preview.tokens.new) {
    entities.push({
      id: (token as { path?: string }).path ?? (token as { id?: string }).id ?? '',
      kind: 'token',
      status: 'new',
    });
  }
  for (const item of preview.tokens.changed) {
    entities.push({ id: item.current.id, kind: 'token', status: 'changed' });
  }

  for (const comp of preview.components.new) {
    entities.push({
      id: (comp as { key?: string }).key ?? (comp as { id?: string }).id ?? '',
      kind: 'component',
      status: 'new',
    });
  }
  for (const item of preview.components.changed) {
    entities.push({
      id: item.current.id,
      kind: 'component',
      status: 'changed',
      isBreaking: item.changeClassification?.classification === 'breaking',
    });
  }

  return entities;
}

function resolveNonInteractiveSelection(entities: SelectableEntity[], opts: SelectOptions): Set<string> {
  const allKeys = new Set(entities.map((e) => makeSelectKey(e.kind, e.id)));

  if (opts.selectAll) {
    if ((opts.select ?? []).length > 0 || (opts.deselect ?? []).length > 0) {
      process.stderr.write('Warning: --select-all overrides --select and --deselect\n');
    }
    return allKeys;
  }

  const hasSelectPatterns = (opts.select ?? []).length > 0;
  const selected = new Set<string>();

  if (!hasSelectPatterns) {
    for (const key of allKeys) selected.add(key);
  } else {
    for (const pattern of opts.select ?? []) {
      for (const key of allKeys) {
        if (key.includes(pattern)) selected.add(key);
      }
    }
  }

  for (const pattern of opts.deselect ?? []) {
    for (const key of [...selected]) {
      if (key.includes(pattern)) selected.delete(key);
    }
  }

  return selected;
}

// --- Interactive Select TUI ---

interface SelectAppProps {
  entities: SelectableEntity[];
  spaceId: string;
  environmentId: string;
  onApply: (selectedKeys: Set<string>) => void;
}

function SelectApp({ entities, spaceId, environmentId, onApply }: SelectAppProps): React.ReactElement {
  const allKeys = new Set(entities.map((e) => makeSelectKey(e.kind, e.id)));

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(allKeys));
  const [importing, setImporting] = useState(false);

  useInput((input, key) => {
    if (importing) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(entities.length - 1, prev + 1));
      return;
    }

    if (input === ' ') {
      const entity = entities[selectedIndex];
      if (!entity) return;
      const k = makeSelectKey(entity.kind, entity.id);
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      });
      return;
    }

    if (input === 'a' || input === 'A') {
      setSelected(new Set(allKeys));
      return;
    }
    if (input === 'n' || input === 'N') {
      setSelected(new Set());
      return;
    }

    if ((input === 'i' || input === 'I') && selected.size > 0) {
      setImporting(true);
      onApply(selected);
      return;
    }

    if (input === 'q' || input === 'Q') {
      process.exit(0);
    }
  });

  return createElement(SelectView, {
    entities,
    spaceId,
    environmentId,
    selectedIndex,
    selected,
    importing,
  });
}

// --- Command registration ---

function collect(val: string, prev: string[]): string[] {
  return [...prev, val];
}

export function registerApplyCommand(program: Command): void {
  const applyCmd = program
    .command('apply')
    .description('Preview, select, or push design system entities to Contentful ExO');

  // --- apply preview ---
  applyCmd
    .command('preview')
    .description('Show a read-only diff of what apply push would do')
    .option('--components <path>', 'Path to components.json (CDF)')
    .option('--tokens <path>', 'Path to tokens.json (DTCG)')
    .option('--session <id>', 'Pipeline session ID to load generated components from')
    .requiredOption('--space-id <id>', 'Contentful space ID')
    .requiredOption('--environment-id <id>', 'Contentful environment ID')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--host <url>', 'Override API base URL')
    .action(async (opts: PreviewOptions) => {
      let inputs: Awaited<ReturnType<typeof resolveSharedInputs>>;
      try {
        inputs = await resolveSharedInputs(opts);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const { components, tokens, client } = inputs;

      try {
        await client.validateToken();
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        const cause = e instanceof Error && e.cause instanceof Error ? e.cause.message : '';
        die(`Error: unable to connect to API host${cause ? `: ${cause}` : ''}`);
      }

      const manifest = buildManifest(components, tokens);

      let preview: ServerPreviewResponse;
      try {
        preview = await client.previewImport(manifest);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const spaceId = opts.spaceId!;
      const environmentId = opts.environmentId!;

      if (process.stdout.isTTY) {
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
        process.exit(0);
      }
    });

  // --- apply push ---
  applyCmd
    .command('push')
    .description('Write component types and design tokens to Contentful ExO')
    .option('--components <path>', 'Path to components.json (CDF)')
    .option('--tokens <path>', 'Path to tokens.json (DTCG)')
    .option('--session <id>', 'Pipeline session ID to load generated components from')
    .requiredOption('--space-id <id>', 'Contentful space ID')
    .requiredOption('--environment-id <id>', 'Contentful environment ID')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--host <url>', 'Override API base URL')
    .option('--yes', 'Skip interactive confirmation')
    .option('--verbose', 'Show all entity progress including skipped/unchanged')
    .option('--force', 'Skip confirmation for breaking changes (for CI)')
    .option('--dry-run', 'Run preview only without applying')
    .action(async (opts: ApplyOptions) => {
      const isTTY = process.stdout.isTTY;

      if (!isTTY && !opts.yes) {
        process.stderr.write('Error: apply push requires --yes in non-interactive mode\n');
        process.exit(1);
      }

      let inputs: Awaited<ReturnType<typeof resolveSharedInputs>>;
      try {
        inputs = await resolveSharedInputs(opts);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const { components, tokens, client } = inputs;

      try {
        await client.validateToken();
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const manifest = buildManifest(components, tokens);

      let preview: ServerPreviewResponse;
      try {
        preview = await client.previewImport(manifest);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const spaceId = opts.spaceId!;
      const environmentId = opts.environmentId!;

      // --- Dry run: print preview and exit ---
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
        process.exit(0);
      }

      // --- Nothing to do: exit early without calling apply ---
      if (isEmptyPreview(preview)) {
        if (isTTY && !opts.yes) {
          process.stderr.write('Nothing to change — design system is up to date.\n');
        } else {
          process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
        }
        process.exit(0);
      }

      const breakingWithImpact = hasBreakingChangesWithImpact(preview);

      // --- Non-interactive: require --force for breaking changes ---
      if (!isTTY || opts.yes) {
        if (breakingWithImpact && !opts.force) {
          process.stderr.write(
            'Error: breaking changes with downstream impact detected. Use --force to acknowledge.\n',
          );
          process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
          process.exit(1);
        }

        const verbose = opts.verbose ?? false;
        if (verbose) {
          process.stderr.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
        }

        let operation: ApplyOperationResponse;
        try {
          operation = await client.applyImport(manifest, breakingWithImpact || opts.force === true);
        } catch (e) {
          if (e instanceof ApiError) die(`Error: ${e.message}`);
          throw e;
        }

        process.stderr.write(`Apply operation started: ${operation.sys.id}\n`);

        try {
          operation = await client.pollOperation(operation.sys.id);
        } catch (e) {
          if (e instanceof ApiError) die(`Error: ${e.message}`);
          throw e;
        }

        const summary = buildApplyOutput(operation, spaceId, environmentId);
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
        process.exit(operation.sys.status === 'succeeded' ? 0 : 1);
        return;
      }

      // --- Interactive (TTY, no --yes) flow ---
      await new Promise<void>((resolvePromise) => {
        const runApply = async (acknowledge: boolean) => {
          instance.rerender(
            createElement(ServerApplyProgress, {
              spaceId,
              environmentId,
              status: 'applying',
            }),
          );

          let operation: ApplyOperationResponse;
          try {
            operation = await client.applyImport(manifest, acknowledge);
          } catch (e) {
            if (e instanceof ApiError) {
              instance.rerender(
                createElement(ServerApplyProgress, {
                  spaceId,
                  environmentId,
                  status: 'error',
                  error: e.message,
                }),
              );
              return;
            }
            throw e;
          }

          instance.rerender(
            createElement(ServerApplyProgress, {
              spaceId,
              environmentId,
              status: 'polling',
              operationId: operation.sys.id,
            }),
          );

          try {
            operation = await client.pollOperation(operation.sys.id);
          } catch (e) {
            if (e instanceof ApiError) {
              instance.rerender(
                createElement(ServerApplyProgress, {
                  spaceId,
                  environmentId,
                  status: 'error',
                  error: e.message,
                }),
              );
              return;
            }
            throw e;
          }

          instance.rerender(
            createElement(ServerApplyDone, {
              operation,
              spaceId,
              environmentId,
            }),
          );
          resolvePromise();
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
              process.exit(0);
            },
          }),
        );

        void instance.waitUntilExit().then(() => resolvePromise());
      });
    });

  // --- apply select ---
  applyCmd
    .command('select')
    .description('Select a subset of entities and push to Contentful ExO')
    .option('--components <path>', 'Path to components.json (CDF)')
    .option('--tokens <path>', 'Path to tokens.json (DTCG)')
    .option('--session <id>', 'Pipeline session ID to load generated components from')
    .requiredOption('--space-id <id>', 'Contentful space ID')
    .requiredOption('--environment-id <id>', 'Contentful environment ID')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--host <url>', 'Override API base URL')
    .option('--select-all', 'Select all entities without launching TUI')
    .option('--select <pattern>', 'Select entities by ID pattern (repeatable)', collect, [])
    .option('--deselect <pattern>', 'Deselect entities by ID pattern (repeatable)', collect, [])
    .option('--force', 'Skip confirmation for breaking changes')
    .action(async (opts: SelectOptions) => {
      const nonInteractive = opts.selectAll || (opts.select ?? []).length > 0 || (opts.deselect ?? []).length > 0;

      if (!nonInteractive && !process.stdout.isTTY) {
        die(
          'Error: apply select requires an interactive terminal unless --select-all, --select, or --deselect is provided',
        );
      }

      let inputs: Awaited<ReturnType<typeof resolveSharedInputs>>;
      try {
        inputs = await resolveSharedInputs(opts);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const { components, tokens, client } = inputs;

      try {
        await client.validateToken();
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const fullManifest = buildManifest(components, tokens);

      let preview: ServerPreviewResponse;
      try {
        preview = await client.previewImport(fullManifest);
      } catch (e) {
        if (e instanceof ApiError) die(`Error: ${e.message}`);
        throw e;
      }

      const spaceId = opts.spaceId!;
      const environmentId = opts.environmentId!;
      const entities = getSelectableEntities(preview);

      if (entities.length === 0) {
        process.stderr.write('Nothing to change — design system is up to date.\n');
        process.exit(0);
      }

      if (nonInteractive) {
        const selectedKeys = resolveNonInteractiveSelection(entities, opts);

        if (selectedKeys.size === 0) {
          process.stderr.write('No entities matched selection criteria.\n');
          process.exit(0);
        }

        const selectedComponentKeys = new Set<string>();
        const selectedTokenPaths = new Set<string>();
        for (const key of selectedKeys) {
          const [kind, ...idParts] = key.split(':');
          const id = idParts.join(':');
          if (kind === 'component') selectedComponentKeys.add(id);
          else if (kind === 'token') selectedTokenPaths.add(id);
        }

        const filteredManifest = buildFilteredManifest(fullManifest, selectedComponentKeys, selectedTokenPaths);
        const hasBreaking = entities.some((e) => e.isBreaking && selectedKeys.has(makeSelectKey(e.kind, e.id)));

        if (hasBreaking && !opts.force) {
          process.stderr.write('Error: selection includes breaking changes. Use --force to acknowledge.\n');
          process.exit(1);
        }

        let operation: ApplyOperationResponse;
        try {
          operation = await client.applyImport(filteredManifest, hasBreaking || opts.force === true);
        } catch (e) {
          if (e instanceof ApiError) die(`Error: ${e.message}`);
          throw e;
        }

        process.stderr.write(`Apply operation started: ${operation.sys.id}\n`);

        try {
          operation = await client.pollOperation(operation.sys.id);
        } catch (e) {
          if (e instanceof ApiError) die(`Error: ${e.message}`);
          throw e;
        }

        const summary = buildApplyOutput(operation, spaceId, environmentId);
        process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
        process.exit(operation.sys.status === 'succeeded' ? 0 : 1);
        return;
      }

      // --- Interactive flow ---
      await new Promise<void>((resolvePromise) => {
        const runSelectApply = async (selectedKeys: Set<string>) => {
          const selectedComponentKeys = new Set<string>();
          const selectedTokenPaths = new Set<string>();
          for (const key of selectedKeys) {
            const [kind, ...idParts] = key.split(':');
            const id = idParts.join(':');
            if (kind === 'component') selectedComponentKeys.add(id);
            else if (kind === 'token') selectedTokenPaths.add(id);
          }

          const filteredManifest = buildFilteredManifest(fullManifest, selectedComponentKeys, selectedTokenPaths);
          const hasBreaking = entities.some((e) => e.isBreaking && selectedKeys.has(makeSelectKey(e.kind, e.id)));

          instance.rerender(
            createElement(ServerApplyProgress, {
              spaceId,
              environmentId,
              status: 'applying',
            }),
          );

          let operation: ApplyOperationResponse;
          try {
            operation = await client.applyImport(filteredManifest, hasBreaking);
          } catch (e) {
            if (e instanceof ApiError) {
              instance.rerender(
                createElement(ServerApplyProgress, {
                  spaceId,
                  environmentId,
                  status: 'error',
                  error: e.message,
                }),
              );
              return;
            }
            throw e;
          }

          instance.rerender(
            createElement(ServerApplyProgress, {
              spaceId,
              environmentId,
              status: 'polling',
              operationId: operation.sys.id,
            }),
          );

          try {
            operation = await client.pollOperation(operation.sys.id);
          } catch (e) {
            if (e instanceof ApiError) {
              instance.rerender(
                createElement(ServerApplyProgress, {
                  spaceId,
                  environmentId,
                  status: 'error',
                  error: e.message,
                }),
              );
              return;
            }
            throw e;
          }

          instance.rerender(
            createElement(ServerApplyDone, {
              operation,
              spaceId,
              environmentId,
            }),
          );
          resolvePromise();
        };

        const instance = render(
          createElement(SelectApp, {
            entities,
            spaceId,
            environmentId,
            onApply: (selectedKeys) => {
              void runSelectApply(selectedKeys);
            },
          }),
        );

        void instance.waitUntilExit().then(() => resolvePromise());
      });
    });
}
