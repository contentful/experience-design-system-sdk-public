// Regression guard: when the wizard runs `analyze select-agent` on a new
// extract session but every component is a select_cache hit (same input hash,
// same prompt hash, same CLI version — e.g. the operator re-runs `experiences
// import` on an unchanged project), the AI-recommended-exclusions section on
// the scope-gate must still populate — status + reject_reason on raw_components
// AND the streamed progress=select-agent: lines the wizard's parser consumes.
//
// Pins the fully-cached path end-to-end because the previous test coverage
// only exercised the LLM path (analyze/select-agent/command.test.ts) and the
// cache path in isolation (select-cache-integration.test.ts), leaving a gap
// where a regression in either the cached-result persist branch or the
// mirrored progress-line contract would go undetected until it surfaced in
// the wizard UI.

import { describe, it, expect, afterEach } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { createTestFixture } from '../../helpers/fixtures.js';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  storeScannedFiles,
  loadScopeComponents,
} from '../../../src/session/db.js';

const cleanupItems: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanupItems.splice(0).map((fn) => fn()));
});

async function makeAgent(
  agentName: string,
  output: string,
): Promise<{ cleanup: () => Promise<void>; env: Record<string, string> }> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-'));
  const script = join(dir, agentName);
  await writeFile(script, `#!/bin/sh\ncat <<'EOF'\n${output}\nEOF\n`, 'utf8');
  await chmod(script, '755');
  return { cleanup: () => rm(dir, { recursive: true, force: true }), env: { PATH: `${dir}:${process.env.PATH}` } };
}

describe('cache hit on new session', () => {
  it('populates raw_components.reject_reason for cached rejected result on a new session', async () => {
    const components = [
      {
        name: 'BadgeIcon',
        source: 'src/BadgeIcon.tsx',
        framework: 'react' as const,
        props: [{ name: 'icon', type: 'string', required: true }],
        slots: [],
      },
    ];
    const fixture = await createTestFixture(components);
    cleanupItems.push(fixture.cleanup);
    const artifactsDir = await mkdtemp(join(tmpdir(), 'artifacts-'));
    cleanupItems.push(() => rm(artifactsDir, { recursive: true, force: true }));

    // First run: session A rejects and populates the select_cache.
    const agent1 = await makeAgent(
      'claude',
      '{"tool":"reject_component","name":"BadgeIcon","reason":"low semantic value","confidence":5}',
    );
    cleanupItems.push(agent1.cleanup);

    const env = {
      EDS_PIPELINE_DB_PATH: fixture.dbPath,
      EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
      NODE_NO_WARNINGS: '1',
      ...agent1.env,
    };
    const r1 = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      env,
    );
    expect(r1.code).toBe(0);

    // Create session B with the same components (simulating a fresh `experiences import`).
    const db = openPipelineDb(fixture.dbPath);
    const { sessionId: sessionB } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
      inputPath: fixture.projectDir,
    });
    storeRawComponents(db, sessionB, components);
    storeScannedFiles(
      db,
      sessionB,
      components.map((c) => c.source),
    );
    db.close();

    // Second run on session B: cache should hit; no LLM call.
    const agent2 = await makeAgent(
      'claude',
      '{"tool":"reject_component","name":"UNUSED","reason":"unused","confidence":5}',
    );
    cleanupItems.push(agent2.cleanup);
    const env2 = { ...env, ...agent2.env };
    const r2 = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', sessionB, '--project-root', fixture.projectDir],
      env2,
    );
    expect(r2.code).toBe(0);
    expect(r2.stderr).toContain('cached');

    // Now check: does loadScopeComponents(db, sessionB) return the rejected row + reason?
    const db2 = openPipelineDb(fixture.dbPath);
    try {
      const rows = loadScopeComponents(db2, sessionB);
      const badge = rows.find((r) => r.name === 'BadgeIcon');
      expect(badge?.aiDecision).toBe('rejected');
      expect(badge?.aiReason).toBe('low semantic value');
    } finally {
      db2.close();
    }
  }, 60000);
});

// ── Wizard-side: stream cache-hit progress lines and confirm scope-gate render ──
import { render } from 'ink-testing-library';
import React from 'react';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';
import { mergeAiDecisions } from '../../../src/import/tui/merge-ai-decisions.js';
import { parseAutoFilterProgressLine } from '../../../src/import/tui/WizardApp.js';

describe('e2e: cached select-agent → scope-gate render', () => {
  it('renders AI section from raw_components after a full cache-hit CLI run on a new session', async () => {
    const components = [
      {
        name: 'BadgeIcon',
        source: 'src/BadgeIcon.tsx',
        framework: 'react' as const,
        props: [{ name: 'icon', type: 'string', required: true }],
        slots: [],
      },
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react' as const,
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ];
    const fixture = await createTestFixture(components);
    cleanupItems.push(fixture.cleanup);
    const artifactsDir = await mkdtemp(join(tmpdir(), 'artifacts-'));
    cleanupItems.push(() => rm(artifactsDir, { recursive: true, force: true }));

    const agent1 = await makeAgent(
      'claude',
      '{"tool":"reject_component","name":"BadgeIcon","reason":"low semantic value","confidence":5}\n' +
        '{"tool":"select_component","name":"Button","reason":"primary UI","confidence":5}',
    );
    cleanupItems.push(agent1.cleanup);
    const env = {
      EDS_PIPELINE_DB_PATH: fixture.dbPath,
      EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
      NODE_NO_WARNINGS: '1',
      ...agent1.env,
    };
    const r1 = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      env,
    );
    expect(r1.code).toBe(0);

    const db = openPipelineDb(fixture.dbPath);
    const { sessionId: sessionB } = getOrCreateSession(db, 'new', undefined, {
      command: 'analyze extract',
      inputPath: fixture.projectDir,
    });
    storeRawComponents(db, sessionB, components);
    storeScannedFiles(
      db,
      sessionB,
      components.map((c) => c.source),
    );
    db.close();

    const agent2 = await makeAgent(
      'claude',
      '{"tool":"reject_component","name":"UNUSED","reason":"unused","confidence":5}',
    );
    cleanupItems.push(agent2.cleanup);
    const r2 = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        sessionB,
        '--project-root',
        fixture.projectDir,
        '--exclude-invalid',
      ],
      { ...env, ...agent2.env },
    );
    expect(r2.code).toBe(0);
    expect(r2.stderr).toContain('cached');
    expect(r2.stderr).toMatch(/progress=select-agent:\d+\/\d+:rejected:BadgeIcon:low%20semantic%20value/);

    const db2 = openPipelineDb(fixture.dbPath);
    let rows;
    try {
      rows = loadScopeComponents(db2, sessionB);
    } finally {
      db2.close();
    }
    const badge = rows.find((r) => r.name === 'BadgeIcon');
    expect(badge?.aiDecision).toBe('rejected');
    expect(badge?.aiReason).toBe('low semantic value');

    const { lastFrame } = render(
      React.createElement(ScopeGateStep, {
        components: [...rows],
        onConfirm: () => {},
        onQuit: () => {},
        aiFilterStatus: 'complete',
      }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AI recommended exclusions');
    expect(frame).toContain('BadgeIcon');
    expect(frame).toContain('low semantic value');
  }, 60000);
});

describe('wizard scope-gate with cache-hit streaming (unit)', () => {
  it('renders AI-recommended-exclusions section from cache-hit progress lines + DB persist', async () => {
    // Simulate what the CLI select-agent stderr emits for a cache hit:
    const stderr = [
      '  [1/2]  BadgeIcon  rejected (cached)  low semantic value',
      'progress=select-agent:1/2:rejected:BadgeIcon:low%20semantic%20value',
      '  [2/2]  Button  accepted (cached)  primary UI',
      'progress=select-agent:2/2:accepted:Button:primary%20UI',
      '',
    ];
    const aiDecisions: Record<string, { decision: 'accepted' | 'rejected' | 'failed'; reason: string }> = {};
    for (const line of stderr) {
      const parsed = parseAutoFilterProgressLine(line.trim());
      if (parsed) aiDecisions[parsed.name] = { decision: parsed.decision, reason: parsed.reason };
    }
    expect(aiDecisions.BadgeIcon).toEqual({ decision: 'rejected', reason: 'low semantic value' });

    // Also simulate DB persist: rows come back with aiDecision + aiReason.
    const dbRows = [
      { name: 'BadgeIcon', componentId: 'b1', aiDecision: 'rejected' as const, aiReason: 'low semantic value' },
      { name: 'Button', componentId: 'b2', aiDecision: 'accepted' as const, aiReason: null },
    ];
    const merged = mergeAiDecisions(dbRows, aiDecisions);
    // Render scope-gate.
    const { lastFrame } = render(
      React.createElement(ScopeGateStep, {
        components: [...merged],
        onConfirm: () => {},
        onQuit: () => {},
        aiFilterStatus: 'complete',
      }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AI recommended exclusions');
    expect(frame).toContain('BadgeIcon');
    expect(frame).toContain('low semantic value');
  });
});
