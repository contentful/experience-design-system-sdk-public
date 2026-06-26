import { createElement } from 'react';
import { render } from 'ink';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import {
  type AgentName,
  parseToolCallLines,
  parseTokenToolCallLines,
  resolveBinary,
  runAgent,
} from './agent-runner.js';
import { OutputFormatter, c } from '../output/format.js';
import { formatGenerateProgressLine } from './progress.js';
import { type Skill, buildPrompt, resolveSkillPath } from './prompt-builder.js';
import { GenerateView } from './tui/GenerateView.js';
import type { GenerateViewResult } from './tui/GenerateView.js';
import { registerGenerateEditCommand } from './edit/command.js';
import {
  openPipelineDb,
  loadRawComponents,
  applyToolCalls,
  applyTokenToolCalls,
  computeComponentInputHash,
  computeTokenInputHash,
  lookupCache,
  lookupCacheByEntity,
  storeCache,
  copyComponentFromCache,
  copyTokensFromCache,
  renameEmptySlots,
  type RawComponentWithId,
} from '../session/db.js';
import { getRefineArtifactsRoot, getRefineSessionPaths } from '../analyze/select/persistence.js';
import type { ReviewSessionSnapshot } from '../analyze/select/types.js';
import type { RawComponentDefinition } from '../types.js';
import { readExperiencesCredentials } from '../credentials-store.js';

const execFileAsync = promisify(execFile);

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'opencode', 'cursor']);
const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 3 * 60 * 1000);
const DEFAULT_COMPONENT_CONCURRENCY = 10;
const RETRY_BACKOFF_MS = Number(process.env.EDS_RETRY_BACKOFF_MS ?? 5_000);

interface GenerateSubcommandOptions {
  agent?: string;
  model?: string;
  session?: string;
  rawTokens?: string;
  tokens?: string;
  tokenMap?: string;
  dryRun?: boolean;
  verbose?: boolean;
  cache?: boolean;
  /** Feature 8: custom skill prompt path for `generate components`. */
  generatePromptPath?: string;
}

/**
 * Feature 8: render the warning banner shown when a custom skill prompt is
 * active. Always cites the bundled invariants that the override bypasses so
 * the operator cannot miss it.
 */
export function formatCustomPromptBanner(skill: 'components' | 'select', path: string): string {
  return (
    `WARNING: Custom prompt active for ${skill}: ${path}\n` +
    `  Bundled invariants (utility-wrapper rejection, description content rules) do NOT apply.\n` +
    `  You are responsible for the prompt's correctness.\n`
  );
}

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

async function assertBinaryInPath(binary: string): Promise<boolean> {
  try {
    await execFileAsync('which', [binary]);
    return true;
  } catch {
    return false;
  }
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

async function runOneComponent(
  agent: AgentName,
  model: string | undefined,
  db: ReturnType<typeof openPipelineDb>,
  sessionId: string,
  component: RawComponentDefinition & { component_id: string },
  tokensInline: string | undefined,
  tokenMapInline: string | undefined,
  index: number,
  total: number,
  verbose: boolean,
  noCache: boolean,
  skillPathOverride: string | undefined,
): Promise<ComponentRunResult> {
  const pos = c.dim(`[${index + 1}/${total}]`);

  if (!noCache) {
    const inputHash = computeComponentInputHash(component as RawComponentWithId);
    const cached = lookupCache(db, inputHash, 'component', component.component_id);
    if (cached) {
      copyComponentFromCache(db, cached.sourceSessionId, sessionId, component.component_id);
      process.stderr.write(`  ${pos}  ${c.bold(component.name)}  ${c.green('cached')}\n`);
      return {
        componentName: component.name,
        classified: 0,
        excluded: 0,
        slots: 0,
        warnings: [],
        failed: false,
        cached: true,
        renamedSlotsCount: 0,
      };
    }
    // Check for pinned (human-edited) entry with a different hash
    const pinned = lookupCacheByEntity(db, 'component', component.component_id);
    if (pinned?.humanEdited) {
      copyComponentFromCache(db, pinned.sourceSessionId, sessionId, component.component_id);
      process.stderr.write(`  ${pos}  ${c.bold(component.name)}  ${c.cyan('pinned (human-edited)')}\n`);
      return {
        componentName: component.name,
        classified: 0,
        excluded: 0,
        slots: 0,
        warnings: [`${component.name}: source changed but human edits preserved`],
        failed: false,
        cached: true,
        renamedSlotsCount: 0,
      };
    }
  }

  // Rename empty-named slots in the DB and patch the in-memory component so the
  // prompt sees the heuristic names. applyToolCalls matches by name — a row with
  // name="" would never be reachable by a classify_slot call otherwise.
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
  const prompt = await buildPrompt({
    skill: 'components',
    mode: 'autonomous',
    rawComponentsInline,
    tokensInline,
    tokenMapInline,
    outDir: process.cwd(),
    componentName: component.name,
    skillPathOverride,
  });

  const maxAttempts = 2;
  let lastError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await new Promise((res) => setTimeout(res, RETRY_BACKOFF_MS));
    let outputBuf = '';
    const formatter = new OutputFormatter(verbose, (s) => {
      outputBuf += s;
    });
    const result = await runAgent({
      agent,
      model,
      prompt,
      interactive: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      onOutput: (chunk) => formatter.push(chunk),
    });
    formatter.flush();

    // Write header + all tool-call output as one block so concurrent workers don't interleave.
    const retryNote = attempt > 1 ? `  ${c.yellow(`retrying (${attempt}/${maxAttempts})`)}` : '';
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}${retryNote}\n${outputBuf}`);

    if (result.timedOut) {
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

    if (result.exitCode !== 0) {
      lastError = `agent exited with code ${result.exitCode}`;
      continue;
    }

    const { calls, warnings } = parseToolCallLines(result.stdout);

    if (calls.length === 0) {
      lastError = 'agent produced no tool calls';
      continue;
    }

    const applied = applyToolCalls(db, sessionId, component.component_id, component.name, calls, warnings);
    if (!noCache) {
      const inputHash = computeComponentInputHash(component as RawComponentWithId);
      storeCache(db, inputHash, 'component', component.component_id, sessionId, false);
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
  agent: AgentName,
  model: string | undefined,
  db: ReturnType<typeof openPipelineDb>,
  sessionId: string,
  components: Array<RawComponentDefinition & { component_id: string }>,
  tokensInline: string | undefined,
  tokenMapInline: string | undefined,
  verbose: boolean,
  noCache: boolean,
  skillPathOverride: string | undefined,
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
      results[i] = await runOneComponent(
        agent,
        model,
        db,
        sessionId,
        components[i]!,
        tokensInline,
        tokenMapInline,
        i,
        components.length,
        verbose,
        noCache,
        skillPathOverride,
      );
      completed += 1;
      process.stderr.write(
        `${formatGenerateProgressLine(completed, components.length, results[i]!.componentName)}\n`,
      );
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, components.length) }, worker));
  return results;
}

function resolveSessionId(sessionFlag: string | undefined): string {
  if (sessionFlag) return sessionFlag;

  const db = openPipelineDb();
  try {
    const row = db
      .prepare(
        `SELECT s.id FROM sessions s
         JOIN steps st ON st.session_id = s.id
         WHERE st.command = 'analyze extract'
           AND st.status = 'complete'
         ORDER BY st.started_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!row) {
      process.stderr.write(
        'Error: no completed analyze extract session found. Run analyze extract first, or pass --session <id>.\n',
      );
      process.exit(1);
    }
    return row.id;
  } finally {
    db.close();
  }
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

async function runGenerateSkill(skill: Skill, opts: GenerateSubcommandOptions, verbose = false): Promise<void> {
  const savedCreds = await readExperiencesCredentials();
  const agentName = opts.agent ?? savedCreds.agent;
  const model = opts.model ?? savedCreds.agentModel;
  if (!agentName || !VALID_AGENTS.has(agentName)) {
    die(
      `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: claude, codex, opencode, cursor`,
    );
  }
  const agent = agentName as AgentName;

  // Feature 8: resolve custom-prompt path for `components` (flag wins over
  // saved credentials), validate, and emit the warning banner once at action
  // entry.
  const generatePromptPath =
    skill === 'components' ? (opts.generatePromptPath ?? savedCreds.generatePromptPath) : undefined;
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

  // Load raw components from DB for the components skill
  let sessionId: string | undefined;
  let allComponents: RawComponentWithId[] | undefined;
  if (skill === 'components') {
    sessionId = resolveSessionId(opts.session);
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
    const prompt = await buildPrompt({
      skill,
      mode: 'autonomous',
      rawComponentsInline: sampleInline ?? rawTokensInline,
      rawTokensInline: skill === 'tokens' ? rawTokensInline : undefined,
      rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
      tokensInline,
      tokenMapInline,
      outDir: process.cwd(),
      skillPathOverride: generatePromptPath,
    });
    process.stdout.write(prompt + '\n');
    process.exit(0);
  }

  const binary = resolveBinary(agent);
  if (!(await assertBinaryInPath(binary))) {
    printFallbackInstructions({
      agent,
      skill,
      sessionId: sessionId ?? '',
    });
    process.exit(1);
  }

  if (skill === 'components' && allComponents && sessionId) {
    const db = openPipelineDb();
    let componentResults: ComponentRunResult[];
    try {
      componentResults = await runAllComponents(
        agent,
        model,
        db,
        sessionId,
        allComponents,
        tokensInline,
        tokenMapInline,
        verbose,
        opts.cache === false || process.env.EDS_NO_CACHE === '1',
        generatePromptPath,
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
        c.dim(`  ${totalClassified} classified, ${totalExcluded} excluded`) +
        '\n',
    );
    // Machine-parseable summary on stdout for the wizard / orchestrator.
    process.stdout.write(`renamed-slots: ${totalRenamedSlots}\n`);

    if (generated.length === 0 && cachedResults.length === 0) {
      die('Error: all components failed to generate — check agent output above');
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

      // Check cache before invoking agent
      if (!noCache) {
        const tokenCached = lookupCache(db, tokenInputHash, 'token_set', '__tokens__');
        if (tokenCached) {
          copyTokensFromCache(db, tokenCached.sourceSessionId, resolvedSessionId);
          sessionId = resolvedSessionId;
          process.stderr.write(
            `Done: tokens reused from cache ${c.dim(`(source: ${tokenCached.sourceSessionId.slice(0, 12)})`)}\n`,
          );
          db.close();
          // Skip agent invocation — jump to view
          const viewResult: GenerateViewResult = { skill, agent, sessionId: sessionId ?? '' };
          if (process.stdout.isTTY) {
            const { waitUntilExit } = render(
              createElement(GenerateView, { result: viewResult, onExit: () => process.exit(0) }),
            );
            await waitUntilExit();
          } else {
            process.stdout.write(`generate complete\nskill: ${skill}\nagent: ${agent}\nsession: ${sessionId ?? ''}\n`);
            process.exit(0);
          }
          return;
        }
      }

      // Cache miss — invoke agent
      const prompt = await buildPrompt({
        skill,
        mode: 'autonomous',
        rawTokensInline,
        rawTokensFilename: opts.rawTokens ? resolve(opts.rawTokens).split('/').pop() : undefined,
        tokensInline,
        tokenMapInline,
        outDir: process.cwd(),
      });

      const result = await runAgent({
        agent,
        model,
        prompt,
        interactive: false,
        timeoutMs: DEFAULT_TIMEOUT_MS * 5,
      });

      if (result.timedOut) {
        die(`Error: agent did not complete within ${(DEFAULT_TIMEOUT_MS * 5) / 60000} minutes`);
      }
      if (result.exitCode !== 0) {
        if (result.stderr) process.stderr.write(result.stderr);
        die(`Error: agent exited with code ${result.exitCode}`);
      }

      const { calls: tokenCalls, warnings: tokenWarnings } = parseTokenToolCallLines(result.stdout);
      const tokenCount = tokenCalls.filter((tc) => tc.tool === 'set_token').length;

      if (tokenCount === 0) {
        process.stderr.write(
          `Error: agent produced no set_token calls.\n` +
            `Run with --dry-run to inspect the prompt.\n\n` +
            `Agent output:\n${result.stdout}\n`,
        );
        process.exit(1);
      }

      if (tokenWarnings.length > 0) {
        process.stderr.write(`Warnings:\n${tokenWarnings.map((w) => `  ${w}`).join('\n')}\n`);
      }

      applyTokenToolCalls(db, resolvedSessionId, tokenCalls, []);
      if (!noCache) {
        storeCache(db, tokenInputHash, 'token_set', '__tokens__', resolvedSessionId, false);
      }
      sessionId = resolvedSessionId;

      const groupCount = tokenCalls.filter((tc) => tc.tool === 'set_group').length;
      process.stderr.write(`Done: ${tokenCount} tokens, ${groupCount} groups stored\n`);
    } finally {
      db.close();
    }
  }

  const viewResult: GenerateViewResult = {
    skill,
    agent,
    sessionId: sessionId ?? '',
  };

  if (process.stdout.isTTY) {
    const { waitUntilExit } = render(
      createElement(GenerateView, {
        result: viewResult,
        onExit: () => process.exit(0),
      }),
    );
    await waitUntilExit();
  } else {
    process.stdout.write(`generate complete\nskill: ${skill}\nagent: ${agent}\nsession: ${sessionId ?? ''}\n`);
    process.exit(0);
  }
}

function addAgentFlags(cmd: Command): Command {
  return cmd
    .option(
      '--agent <name>',
      'Agent to use: claude, codex, opencode, cursor (defaults to value saved by experiences setup)',
    )
    .option('--model <name>', 'Model to use (defaults to a small/fast model per agent)')
    .option('--verbose', 'Show full agent output including reasoning text')
    .option('--dry-run', 'Print the prompt without invoking the agent')
    .option('--no-cache', 'Bypass generation cache and force AI re-generation');
}

export function registerGenerateCommand(program: Command): void {
  const generate = program.command('generate').description('Generate CDF/DTCG artifacts or correct generation output');

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
    );
  addAgentFlags(componentsCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateSkill('components', opts, opts.verbose ?? false);
  });
  registerGenerateEditCommand(componentsCmd, 'components');

  // generate tokens subcommand
  const tokensCmd = generate
    .command('tokens')
    .description('Invoke a coding agent to produce tokens.json from raw token data')
    .option('--raw-tokens <path>', 'Path to raw token input file');
  addAgentFlags(tokensCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateSkill('tokens', opts, opts.verbose ?? false);
  });
  registerGenerateEditCommand(tokensCmd, 'tokens');
}
