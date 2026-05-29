import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  updateStep,
  findLatestSessionForCommand,
} from '../session/db.js';

export interface PipelineOptions {
  project: string;
  out: string;
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  agent: string;
  model?: string;
  skipAnalyze: boolean;
  skipGenerate: boolean;
  print: boolean;
  skipApply: boolean;
  noCache: boolean;
  yes: boolean;
  verbose: boolean;
  tokens?: string;
  viewports?: string;
  host?: string;
  dryRun?: boolean;
  selectAll?: boolean;
  select?: string[];
  deselect?: string[];
}

export interface StepResult {
  step: string;
  status: 'complete' | 'failed' | 'skipped';
  durationMs?: number;
  reason?: string;
  detail?: Record<string, unknown>;
  error?: string;
}

export interface PipelineResult {
  session: string;
  project: string;
  steps: StepResult[];
}

function findCliPath(): string {
  return join(fileURLToPath(import.meta.url), '..', '..', '..', '..', 'bin', 'cli.js');
}

async function runStep(
  args: string[],
  cliPath: string,
  env: NodeJS.ProcessEnv = {},
  streamStderr = false,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = execFile('node', [cliPath, ...args], {
      env: { ...process.env, ...env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (streamStderr) process.stderr.write(text);
    });

    child.on('close', (code) => {
      res({ exitCode: code ?? 0, stdout, stderr });
    });
  });
}

export async function runPipeline(
  opts: PipelineOptions,
  progressWriter: (line: string) => void,
  cliPathOverride?: string,
): Promise<PipelineResult> {
  const projectRoot = resolve(opts.project);
  const outDir = resolve(opts.out);
  const componentsPath = join(outDir, 'components.json');
  const cliPath = cliPathOverride ?? findCliPath();

  const db = openPipelineDb();
  const { sessionId } = getOrCreateSession(db, undefined, undefined, {
    command: 'import',
    inputPath: projectRoot,
    outDir,
  });

  progressWriter(`Experience Design System CLI — Pipeline Import`);
  progressWriter(`Project:     ${projectRoot}`);
  progressWriter(`Output:      ${outDir}`);
  if (opts.spaceId) progressWriter(`Space:       ${opts.spaceId} (${opts.environmentId})`);
  progressWriter(`Session:     ${sessionId}`);
  progressWriter('');

  await mkdir(outDir, { recursive: true });

  const steps: StepResult[] = [];
  let stepNum = 0;

  // print components is an optional step; adjust total accordingly
  const totalSteps = 4 + (opts.print ? 1 : 0);

  function stepLabel(name: string): string {
    stepNum++;
    return `  Step ${stepNum}/${totalSteps}  ${name}  `;
  }

  // ── Step 1: analyze extract ──────────────────────────────────────────────
  const analyzeLabel = stepLabel('Statically analyzing project');
  const analyzeSkipped = !opts.noCache && opts.skipAnalyze;
  let extractSessionId: string | null = null;

  if (analyzeSkipped) {
    progressWriter(`${analyzeLabel}–  skipped (--skip-analyze)`);
    steps.push({
      step: 'analyze extract',
      status: 'skipped',
      reason: '--skip-analyze',
    });
    // Try to find a prior extract session to hand to downstream steps
    const prior = findLatestSessionForCommand(db, 'analyze extract');
    extractSessionId = prior ?? null;
  } else {
    const stepId = createStep(db, sessionId, 'analyze extract', {
      project: projectRoot,
    });
    const t0 = Date.now();
    const analyzeArgs = ['analyze', 'extract', '--project', projectRoot];
    const r = await runStep(analyzeArgs, cliPath);
    const durationMs = Date.now() - t0;

    if (r.exitCode !== 0) {
      if (r.stderr) process.stderr.write(r.stderr);
      updateStep(db, stepId, 'failed', {}, r.stderr);
      progressWriter(`${analyzeLabel}✗  failed (${(durationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'analyze extract',
        status: 'failed',
        durationMs,
        error: r.stderr,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    // Read session ID from DB — avoids dependence on subprocess stdout format.
    extractSessionId = findLatestSessionForCommand(db, 'analyze extract') ?? null;

    const componentMatch = /Extracted (\d+) component/.exec(r.stderr);
    const componentCount = componentMatch ? Number(componentMatch[1]) : 0;
    updateStep(db, stepId, 'complete', {
      extractSessionId: extractSessionId ?? '',
    });
    progressWriter(
      `${analyzeLabel}✓  ${componentCount} component${componentCount === 1 ? '' : 's'} found  (${(durationMs / 1000).toFixed(1)}s)`,
    );
    steps.push({
      step: 'analyze extract',
      status: 'complete',
      durationMs,
      detail: { components: componentCount },
    });
  }

  // ── Step 2: analyze select ───────────────────────────────────────────────
  const editLabel = stepLabel('Filtering components');
  if (analyzeSkipped) {
    progressWriter(`${editLabel}–  skipped (--skip-analyze)`);
    steps.push({
      step: 'analyze select',
      status: 'skipped',
      reason: '--skip-analyze',
    });
  } else if (extractSessionId) {
    const editStepId = createStep(db, sessionId, 'analyze select', {
      extractSession: extractSessionId,
    });
    const t0Edit = Date.now();

    // Use agentic select when an agent is available and no manual select/deselect patterns are given.
    const useAgentSelect =
      !opts.selectAll && (!opts.select || opts.select.length === 0) && (!opts.deselect || opts.deselect.length === 0);

    let editArgs: string[];
    if (useAgentSelect) {
      editArgs = ['analyze', 'select-agent', '--session', extractSessionId, '--agent', opts.agent];
      if (opts.model) editArgs.push('--model', opts.model);
    } else {
      editArgs = ['analyze', 'select', '--session', extractSessionId];
      if (opts.select && opts.select.length > 0) {
        for (const p of opts.select) editArgs.push('--select', p);
      } else if (opts.deselect && opts.deselect.length > 0) {
        for (const p of opts.deselect) editArgs.push('--deselect', p);
        editArgs.push('--select-all'); // select-all with deselect patterns = select all except matches
      } else {
        editArgs.push('--select-all');
      }
    }

    const rEdit = await runStep(editArgs, cliPath, { FORCE_COLOR: '1' }, useAgentSelect);
    const editDurationMs = Date.now() - t0Edit;

    if (rEdit.exitCode !== 0) {
      if (rEdit.stderr && !useAgentSelect) process.stderr.write(rEdit.stderr);
      updateStep(db, editStepId, 'failed', {}, rEdit.stderr);
      progressWriter(`${editLabel}✗  failed (${(editDurationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'analyze select',
        status: 'failed',
        durationMs: editDurationMs,
        error: rEdit.stderr,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    const acceptedMatch = /Accepted: (\d+)/.exec(rEdit.stderr);
    const acceptedCount = acceptedMatch ? Number(acceptedMatch[1]) : 0;
    updateStep(db, editStepId, 'complete', {
      extractSession: extractSessionId,
    });
    progressWriter(`${editLabel}✓  ${acceptedCount} accepted  (${(editDurationMs / 1000).toFixed(1)}s)`);
    steps.push({
      step: 'analyze select',
      status: 'complete',
      durationMs: editDurationMs,
      detail: { accepted: acceptedCount },
    });
  } else {
    progressWriter(`${editLabel}–  skipped (no extract session)`);
    steps.push({
      step: 'analyze select',
      status: 'skipped',
      reason: 'no extract session',
    });
  }

  // ── Step 3: generate components ──────────────────────────────────────────

  if (opts.skipGenerate) {
    const generateLabel = stepLabel('Categorizing component props');
    progressWriter(`${generateLabel}–  skipped (--skip-generate)`);
    steps.push({
      step: 'generate components',
      status: 'skipped',
      reason: '--skip-generate',
    });
  } else {
    const generateLabel = stepLabel('Categorizing component props');
    const generateArgs = ['generate', 'components', '--agent', opts.agent];
    if (opts.model) generateArgs.push('--model', opts.model);
    if (extractSessionId) generateArgs.push('--session', extractSessionId);
    if (opts.dryRun) generateArgs.push('--dry-run');
    if (opts.verbose) generateArgs.push('--verbose');

    const stepId = createStep(db, sessionId, 'generate components', {
      extractSession: extractSessionId ?? '',
    });
    const t0 = Date.now();
    const r = await runStep(generateArgs, cliPath, { FORCE_COLOR: '1' }, true);
    const durationMs = Date.now() - t0;

    if (r.exitCode !== 0) {
      updateStep(db, stepId, 'failed', {}, r.stderr);
      progressWriter(`${generateLabel}✗  failed (${(durationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'generate components',
        status: 'failed',
        durationMs,
        error: r.stderr,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    if (opts.dryRun) {
      updateStep(db, stepId, 'complete', { dryRun: 'true' });
      progressWriter(`${generateLabel}✓  prompt printed  (${(durationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'generate components',
        status: 'complete',
        durationMs,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    updateStep(db, stepId, 'complete', {
      extractSession: extractSessionId ?? '',
    });
    progressWriter(`${generateLabel}✓  components stored locally  (${(durationMs / 1000).toFixed(1)}s)`);
    steps.push({ step: 'generate components', status: 'complete', durationMs });
  }

  // ── Step 4 (optional): print components ─────────────────────────────────
  if (opts.print) {
    const printLabel = stepLabel('Writing components.json');
    const printArgs = ['print', 'components', '--out', componentsPath];
    if (extractSessionId) printArgs.push('--session', extractSessionId);

    const stepId = createStep(db, sessionId, 'print components', {
      out: componentsPath,
    });
    const t0 = Date.now();
    const r = await runStep(printArgs, cliPath);
    const durationMs = Date.now() - t0;

    if (r.exitCode !== 0) {
      if (r.stderr) process.stderr.write(r.stderr);
      updateStep(db, stepId, 'failed', {}, r.stderr);
      progressWriter(`${printLabel}✗  failed (${(durationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'print components',
        status: 'failed',
        durationMs,
        error: r.stderr,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    updateStep(db, stepId, 'complete', { components: componentsPath });
    progressWriter(`${printLabel}✓  components.json written  (${(durationMs / 1000).toFixed(1)}s)`);
    steps.push({ step: 'print components', status: 'complete', durationMs });
  }

  // ── Step 4/5: apply push ─────────────────────────────────────────────────
  const applyLabelText =
    opts.spaceId && opts.environmentId
      ? `Applying changes to Space: ${opts.spaceId} Environment: ${opts.environmentId}`
      : 'Applying changes to Contentful';
  if (opts.skipApply) {
    const pushLabel = stepLabel(applyLabelText);
    progressWriter(`${pushLabel}–  skipped (--skip-apply)`);
    steps.push({
      step: 'apply push',
      status: 'skipped',
      reason: '--skip-apply',
    });
  } else {
    const pushLabel = stepLabel(applyLabelText);

    if (!opts.spaceId || !opts.environmentId || !opts.cmaToken) {
      process.stderr.write(
        'Error: --space-id, --environment-id, and --cma-token are required for apply push. Use --skip-apply to skip.\n',
      );
      db.close();
      process.exit(1);
    }

    const pushArgs = [
      'apply',
      'push',
      '--space-id',
      opts.spaceId,
      '--environment-id',
      opts.environmentId,
      '--cma-token',
      opts.cmaToken,
    ];

    // Components are stored under the extract session ID (generate command uses resolveSessionId
    // which returns the passed --session value, i.e. the extract session). Pass that directly so
    // apply push reads from the DB without needing a components.json file.
    // Fall back to --components so the step fails with a clear error rather than a generic one.
    if (extractSessionId) {
      pushArgs.push('--session', extractSessionId);
    } else {
      pushArgs.push('--components', componentsPath);
    }

    if (opts.tokens) pushArgs.push('--tokens', opts.tokens);
    if (opts.viewports) pushArgs.push('--viewports', opts.viewports);
    if (opts.host) pushArgs.push('--host', opts.host);
    if (opts.verbose) pushArgs.push('--verbose');
    pushArgs.push('--yes'); // always non-interactive in subprocess context

    const pushStepId = createStep(db, sessionId, 'apply push', {
      components: componentsPath,
    });
    const t0 = Date.now();
    const r = await runStep(pushArgs, cliPath, { FORCE_COLOR: '1' }, true);
    const durationMs = Date.now() - t0;

    // Parse push result JSON from stdout to distinguish partial vs total failure
    interface PushCounts {
      created: number;
      updated: number;
      failed: number;
    }
    interface PushOutput {
      componentTypes?: PushCounts;
      designTokens?: PushCounts;
    }
    let pushResult: PushOutput | null = null;
    try {
      pushResult = JSON.parse(r.stdout) as PushOutput;
    } catch {
      // stdout wasn't JSON — fall back to regex parsing
    }

    const created = pushResult
      ? (pushResult.componentTypes?.created ?? 0) + (pushResult.designTokens?.created ?? 0)
      : Number(/(\d+) created/.exec(r.stdout + r.stderr)?.[1] ?? 0);
    const updated = pushResult
      ? (pushResult.componentTypes?.updated ?? 0) + (pushResult.designTokens?.updated ?? 0)
      : Number(/(\d+) updated/.exec(r.stdout + r.stderr)?.[1] ?? 0);
    const failed = pushResult
      ? (pushResult.componentTypes?.failed ?? 0) + (pushResult.designTokens?.failed ?? 0)
      : Number(/(\d+) failed/.exec(r.stdout + r.stderr)?.[1] ?? 0);
    const totalPushed = created + updated + failed;

    if (r.exitCode !== 0 && (totalPushed === 0 || failed === totalPushed)) {
      // Total failure — nothing was pushed
      updateStep(db, pushStepId, 'failed', {}, r.stderr);
      progressWriter(`${pushLabel}✗  failed (${(durationMs / 1000).toFixed(1)}s)`);
      steps.push({
        step: 'apply push',
        status: 'failed',
        durationMs,
        error: r.stderr,
      });
      db.close();
      return { session: sessionId, project: projectRoot, steps };
    }

    const stepStatus = failed > 0 ? 'failed' : 'complete';
    updateStep(db, pushStepId, stepStatus === 'complete' ? 'complete' : 'failed', { components: componentsPath });
    const statusIcon = failed > 0 ? '⚠' : '✓';
    progressWriter(
      `${pushLabel}${statusIcon}  ${created} created, ${updated} updated, ${failed} failed  (${(durationMs / 1000).toFixed(1)}s)`,
    );
    steps.push({
      step: 'apply push',
      status: stepStatus,
      durationMs,
      detail: { created, updated, failed },
    });
  }

  progressWriter('');
  progressWriter(`Pipeline complete. Session: ${sessionId}`);

  if (opts.spaceId && opts.environmentId && !opts.skipApply) {
    progressWriter('');
    progressWriter(
      `View your design system:  https://app.contentful.com/spaces/${opts.spaceId}/environments/${opts.environmentId}/exo/components`,
    );
  }

  db.close();
  return { session: sessionId, project: projectRoot, steps };
}
