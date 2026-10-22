import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureSourceEvidence } from '../../src/steps/extraction/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import * as pipeline from '../../src/index.js';
import {
  beginExplorationRun,
  publishExplorationRun,
  storeExplorationAttempt,
} from '../../src/persistence/src/session/repositories/exploration/records.js';

const api = pipeline;
let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  dir = mkdtempSync(join(tmpdir(), 'exploration-session-'));
  const source = join(dir, 'panel.tsx');
  writeFileSync(source, 'export interface PanelProps { renderBody?: unknown }\n');
  const dbPath = join(dir, 'pipeline.db');
  const db = pipeline.openPipelineDb(dbPath);
  const { sessionId } = pipeline.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = pipeline.createStep(db, sessionId, 'analyze extract', { project: dir });
  const raw = {
    name: 'Panel',
    source,
    sourcePath: source,
    framework: 'react' as const,
    props: [{ name: 'label', type: 'string', required: false }],
    slots: [{ name: 'renderBody', isDefault: false, allowedComponents: ['Text'] }],
  };
  pipeline.storeRawComponents(db, sessionId, [raw]);
  const component = pipeline.loadRawComponents(db, sessionId)[0]!;
  const capture = await captureSourceEvidence({
    projectRoot: dir,
    filePaths: [source],
    components: [{ componentId: component.component_id, name: component.name, sourcePath: source }],
  });
  const handle = pipeline.completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: [raw],
    cycles: [],
    scannedFiles: [source],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  return { db, dbPath, sessionId, component, handle, source };
}

describe('connected exploration persistence and output', () => {
  it('publishes all seven scopes then cold-reads open decisions without changing raw candidates', async () => {
    const { db, dbPath, sessionId, component, handle, source } = await fixture();
    db.close();
    const calls: string[] = [];
    const invoker = {
      invoke: async (request: { prompt: string }) => {
        const scope = /"scope":"([^"]+)"/.exec(request.prompt)?.[1];
        calls.push(scope!);
        const candidateFree = scope === 'components-6' || scope === 'components-7';
        if (candidateFree) expect(request.prompt).not.toContain('"slotCandidates"');
        return {
          stdout: JSON.stringify({
            agentRole: scope,
            components: [
              {
                name: 'Panel',
                source,
                componentId: component.component_id,
                included: true,
                modelingNotes: ['Source requires a runtime provider; independent rendering remains unverified.'],
                ...(candidateFree
                  ? {}
                  : {
                      slots: [
                        { name: 'renderBody', isRealSlot: true, allowedComponents: [], evidence: ['declared input'] },
                      ],
                    }),
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    };
    expect(api.runExplorationComponentsSession).toBeTypeOf('function');
    const result = await api.runExplorationComponentsSession({
      dbPath,
      sessionId,
      sourceEvidenceHandle: handle,
      agent: 'codex',
      invoker,
      rendererReference: { kind: 'text', text: 'Components receive their declared inputs.', origin: 'fixture' },
      backoffMs: 0,
    });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(7);
    const artifacts = join(dir, 'exploration-artifacts', encodeURIComponent(sessionId), result.runId!, 'components');
    const manifest = JSON.parse(readFileSync(join(artifacts, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({
      publicationAuthority: 'session-database',
      state: 'computed',
      identity: { sessionId, runId: result.runId },
    });
    expect(manifest.artifacts.map((artifact: { name: string }) => artifact.name)).toContain('accepted.json');
    expect(manifest.stageAttempts).toHaveLength(7);
    const reopened = pipeline.openPipelineDb(dbPath);
    try {
      const scoped = pipeline.loadScopeComponents(reopened, sessionId)[0]!;
      expect(scoped.modelingNotes).toEqual([
        'Source requires a runtime provider; independent rendering remains unverified.',
      ]);
      expect(scoped.aiDecision).toBe('accepted');
      expect(scoped.needsReview).toBe(false);
      expect(scoped.slots).toEqual([{ name: 'renderBody', allowedComponents: [] }]);
      const beforeNotes = reopened
        .prepare('SELECT status, needs_review FROM raw_components WHERE session_id=?')
        .all(sessionId);
      const savedReport = reopened
        .prepare('SELECT scope,payload_json FROM exploration_reports WHERE run_id=? ORDER BY scope')
        .get(result.runId!) as { scope: string; payload_json: string };
      const report = JSON.parse(savedReport.payload_json);
      report.companion.components.push(
        { ...report.companion.components[0], componentId: 'different-owner', modelingNotes: ['Unrelated owner'] },
        { ...report.companion.components[0], source: join(dir, 'different.tsx'), modelingNotes: ['Different source'] },
        { ...report.companion.components[0], name: 'Other', modelingNotes: ['Different declaration'] },
      );
      reopened
        .prepare('UPDATE exploration_reports SET payload_json=? WHERE run_id=? AND scope=?')
        .run(JSON.stringify(report), result.runId!, savedReport.scope);
      expect(pipeline.loadScopeComponents(reopened, sessionId)[0]?.modelingNotes).toEqual(scoped.modelingNotes);
      expect(
        reopened.prepare('SELECT status, needs_review FROM raw_components WHERE session_id=?').all(sessionId),
      ).toEqual(beforeNotes);
      pipeline.applyToolCalls(
        reopened,
        sessionId,
        component.component_id,
        'Panel',
        [
          { tool: 'classify_component' },
          { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' },
          { tool: 'classify_slot', slot: 'renderBody', allowed_components: ['Text'], required: true },
        ],
        [],
      );
      const entry = pipeline.loadCDFComponents(reopened, sessionId)[0]!.entry;
      expect(entry.$slots?.renderBody?.$allowedComponents).toBeUndefined();
      expect(entry.$slots?.renderBody?.$required).toBeUndefined();
      const before = reopened.prepare('SELECT name FROM raw_slots WHERE session_id = ?').all(sessionId);
      pipeline.storeCDFComponents(reopened, sessionId, [{ key: 'Panel', entry: { ...entry, $slots: {} } }]);
      expect(reopened.prepare('SELECT name FROM raw_slots WHERE session_id = ?').all(sessionId)).toEqual(before);
      expect(pipeline.loadCDFComponents(reopened, sessionId)[0]!.entry.$slots).toBeUndefined();
    } finally {
      reopened.close();
    }
  });

  it('retains successful reports when a later scope fails and publishes no accepted phase', async () => {
    const { db, dbPath, sessionId, component, handle, source } = await fixture();
    db.close();
    const invoker = {
      invoke: async (request: { prompt: string }) => {
        const scope = /"scope":"([^"]+)"/.exec(request.prompt)?.[1];
        if (scope !== 'components-1') return { stdout: '', stderr: 'failure', exitCode: 1, timedOut: false };
        return {
          stdout: JSON.stringify({
            agentRole: scope,
            components: [
              {
                name: 'Panel',
                source,
                componentId: component.component_id,
                included: true,
                slots: [{ name: 'renderBody', isRealSlot: false }],
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    };
    expect(api.runExplorationComponentsSession).toBeTypeOf('function');
    const result = await api.runExplorationComponentsSession({
      dbPath,
      sessionId,
      sourceEvidenceHandle: handle,
      agent: 'codex',
      invoker,
      rendererReference: { kind: 'text', text: 'Reference.', origin: 'fixture' },
      backoffMs: 0,
    });
    expect(result.ok).toBe(false);
    const reopened = pipeline.openPipelineDb(dbPath);
    try {
      expect(api.loadExplorationRun(reopened, sessionId, 'components')!.status).toBe('failed');
      expect(api.loadExplorationReports(reopened, sessionId, 'components')).toHaveLength(1);
      expect(() => api.loadAcceptedSlotDecisions(reopened, sessionId)).toThrow('stale or incomplete');
      expect(pipeline.loadScopeComponents(reopened, sessionId)).toEqual([]);
    } finally {
      reopened.close();
    }
  });
});

it('accounts for exhausted final artifact writes and retains every successful scope without publication', async () => {
  const { db, dbPath, sessionId, component, handle, source } = await fixture();
  db.close();
  const outDir = join(dir, 'artifacts');
  const result = await api.runExplorationComponentsSession({
    dbPath,
    sessionId,
    sourceEvidenceHandle: handle,
    outDir,
    agent: 'codex',
    backoffMs: 0,
    rendererReference: { kind: 'text', text: 'Reference', origin: 'fixture' },
    invoker: {
      invoke: async ({ prompt }) => {
        const scope = /"scope":"([^"\n]+)"/.exec(prompt)?.[1];
        return {
          stdout: JSON.stringify({
            agentRole: scope,
            components: [
              {
                name: 'Panel',
                source,
                componentId: component.component_id,
                included: true,
                ...(scope === 'components-6' || scope === 'components-7'
                  ? {}
                  : { slots: [{ name: 'renderBody', isRealSlot: false }] }),
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    },
    onProgress: (_, scope) => {
      if (scope !== 'components-7') return;
      const sessionDir = join(outDir, encodeURIComponent(sessionId));
      const runDir = join(sessionDir, readdirSync(sessionDir)[0]!, 'components');
      mkdirSync(join(runDir, 'accepted.json'));
    },
  });
  expect(result.ok).toBe(false);
  const reopened = api.openPipelineDb(dbPath);
  try {
    expect(api.loadExplorationRun(reopened, sessionId, 'components')?.status).toBe('failed');
    expect(api.loadExplorationReports(reopened, sessionId, 'components')).toHaveLength(7);
    const attempts = api
      .loadExplorationAttempts(reopened, sessionId, 'components')
      .filter((attempt) => attempt.stage === 'finalize');
    expect(attempts).toHaveLength(6);
    expect(attempts.every((attempt) => !attempt.ok && attempt.identity?.digest === handle.digest)).toBe(true);
    expect(api.loadScopeComponents(reopened, sessionId)).toEqual([]);
  } finally {
    reopened.close();
  }
});

it('rejects source-mismatched report identities at the real session boundary', async () => {
  const { db, dbPath, sessionId, component, handle } = await fixture();
  db.close();
  const result = await api.runExplorationComponentsSession({
    dbPath,
    sessionId,
    sourceEvidenceHandle: handle,
    agent: 'codex',
    backoffMs: 0,
    rendererReference: { kind: 'text', text: 'Reference', origin: 'fixture' },
    invoker: {
      invoke: async ({ prompt }) => ({
        stdout: JSON.stringify({
          agentRole: /"scope":"([^"\n]+)"/.exec(prompt)?.[1],
          components: [{ name: 'Panel', source: 'other.tsx', componentId: component.component_id, included: true }],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      }),
    },
  });
  expect(result.ok).toBe(false);
  const reopened = api.openPipelineDb(dbPath);
  try {
    expect(api.loadExplorationReports(reopened, sessionId, 'components')).toEqual([]);
    expect(api.loadExplorationAttempts(reopened, sessionId, 'components')).toHaveLength(6);
    expect(api.loadScopeComponents(reopened, sessionId)).toEqual([]);
    expect(api.loadRawComponents(reopened, sessionId)).toHaveLength(1);
  } finally {
    reopened.close();
  }
});

describe('phase freshness and review metadata', () => {
  it('retains independent phase attempts and rejects superseded publication', async () => {
    const { db, sessionId, handle } = await fixture();
    try {
      const identity = {
        sessionId,
        envelopeId: handle.envelopeId,
        digest: handle.digest,
        phase: 'components' as const,
      };
      const old = beginExplorationRun(db, identity);
      const current = beginExplorationRun(db, identity);
      expect(() => publishExplorationRun(db, old.runId, { inclusion: [], slots: [] })).toThrow('Stale');
      storeExplorationAttempt(db, current.runId, {
        stage: 'check',
        component: 'Panel',
        attempt: 1,
        ok: true,
        operationId: 'one',
      });
      storeExplorationAttempt(db, current.runId, {
        stage: 'check',
        component: 'Panel',
        attempt: 1,
        ok: true,
        operationId: 'two',
      });
      expect(api.loadExplorationAttempts(db, sessionId, 'components')).toHaveLength(2);
    } finally {
      db.close();
    }
  });
  it('durably records host reference failures before any scope invocation', async () => {
    const { db, dbPath, sessionId, handle } = await fixture();
    db.close();
    const result = await api.runExplorationComponentsSession({
      dbPath,
      sessionId,
      sourceEvidenceHandle: handle,
      agent: 'codex',
      rendererReference: { kind: 'path', path: join(dir, 'missing.md') },
    });
    expect(result.ok).toBe(false);
    const reopened = pipeline.openPipelineDb(dbPath);
    try {
      expect(api.loadExplorationAttempts(reopened, sessionId, 'components')).toEqual([
        expect.objectContaining({ stage: 'prepare', ok: false, identity: expect.objectContaining({ sessionId }) }),
      ]);
      expect(api.loadExplorationRun(reopened, sessionId, 'components')!.status).toBe('failed');
    } finally {
      reopened.close();
    }
  });
  it('runs only confirmed components through three detail inventories and exposes record-only review data', async () => {
    const { db, dbPath, sessionId, component, handle, source } = await fixture();
    db.close();
    const seen: string[] = [];
    const invoker = {
      invoke: async ({ prompt }: { prompt: string }) => {
        const scope = /"scope":"([^"\n]+)"/.exec(prompt)?.[1];
        seen.push(scope!);
        return {
          stdout: JSON.stringify({
            agentRole: scope,
            components: [
              {
                name: 'Panel',
                source,
                componentId: component.component_id,
                included: true,
                ...(scope === 'components-6' || scope === 'components-7'
                  ? {}
                  : {
                      slots: [
                        { name: 'renderBody', isRealSlot: true, evidence: ['Declared input'], allowedComponents: [] },
                      ],
                    }),
              },
            ],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    };
    const request = {
      dbPath,
      sessionId,
      sourceEvidenceHandle: handle,
      agent: 'codex' as const,
      invoker,
      rendererReference: { kind: 'text' as const, text: 'Reference', origin: 'fixture' },
      backoffMs: 0,
    };
    expect((await api.runExplorationComponentsSession(request)).ok).toBe(true);
    const confirmDb = pipeline.openPipelineDb(dbPath);
    try {
      pipeline.applyScopeDecisions(confirmDb, sessionId, {
        accepted: ['Panel'],
        rejected: [],
        acceptedProvenance: { Panel: { kind: 'direct', roots: ['Panel'] } },
      });
    } finally {
      confirmDb.close();
    }
    expect((await api.runExplorationDetailSession({ ...request, selectedNames: ['Panel'] })).ok).toBe(true);
    expect(seen.slice(7)).toEqual(['full-inventory-1', 'full-inventory-2', 'full-inventory-3']);
    const reopened = pipeline.openPipelineDb(dbPath);
    try {
      const metadata = pipeline.loadComponentReviewMetadata(reopened, sessionId, 'Panel');
      expect(metadata?.exploration).toMatchObject({
        inclusion: { decision: 'accepted' },
        slots: [expect.objectContaining({ state: 'open' })],
        detail: { recordOnly: true },
      });
    } finally {
      reopened.close();
    }
  });
});

it('records an abort after a durable sibling scope without publishing accepted decisions', async () => {
  const { db, dbPath, sessionId, component, handle, source } = await fixture();
  db.close();
  const controller = new AbortController();
  const invocation = {
    invoke: async ({ prompt }: { prompt: string }) => {
      const scope = /"scope":"([^"\n]+)"/.exec(prompt)?.[1];
      if (scope === 'components-2') controller.abort();
      return {
        stdout: JSON.stringify({
          agentRole: scope,
          components: [
            {
              name: 'Panel',
              source,
              componentId: component.component_id,
              included: true,
              slots: [{ name: 'renderBody', isRealSlot: false }],
            },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  };
  await expect(
    api.runExplorationComponentsSession({
      dbPath,
      sessionId,
      sourceEvidenceHandle: handle,
      agent: 'codex',
      invoker: invocation,
      signal: controller.signal,
      rendererReference: { kind: 'text', text: 'Reference', origin: 'fixture' },
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  const reopened = api.openPipelineDb(dbPath);
  try {
    expect(api.loadExplorationRun(reopened, sessionId, 'components')?.status).toBe('cancelled');
    expect(api.loadExplorationReports(reopened, sessionId, 'components')).toHaveLength(1);
    expect(api.loadExplorationReports(reopened, sessionId, 'components')[0]?.attempts).toMatchObject([{ ok: true }]);
    expect(api.loadExplorationAttempts(reopened, sessionId, 'components').at(-1)).toMatchObject({
      scope: 'components-2',
      ok: false,
    });
    expect(api.loadScopeComponents(reopened, sessionId)).toEqual([]);
  } finally {
    reopened.close();
  }
});

it('persists assigned coverage and earlier exclusions when a whole assigned component is omitted later', async () => {
  const { db, dbPath, sessionId, component, handle, source } = await fixture();
  db.close();
  const result = await api.runExplorationComponentsSession({
    dbPath,
    sessionId,
    sourceEvidenceHandle: handle,
    agent: 'codex',
    maxAttempts: 2,
    backoffMs: 0,
    rendererReference: { kind: 'text', text: 'Declared inputs.', origin: 'fixture' },
    invoker: {
      invoke: async ({ prompt }) => {
        const scope = /"scope":"([^"]+)"/.exec(prompt)?.[1];
        return {
          stdout: JSON.stringify({
            agentRole: scope,
            components:
              scope === 'components-1'
                ? [{ name: 'Panel', source, componentId: component.component_id, included: false }]
                : [],
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    },
  });
  expect(result.ok).toBe(false);
  const reopened = api.openPipelineDb(dbPath);
  try {
    const reports = api.loadExplorationReports(reopened, sessionId, 'components');
    expect(reports).toHaveLength(1);
    expect(reports[0]?.coverage).toMatchObject({
      complete: true,
      requested: [{ name: 'Panel', source, componentId: component.component_id }],
      excluded: [{ name: 'Panel', source, componentId: component.component_id }],
    });
    expect(
      api
        .loadExplorationAttempts(reopened, sessionId, 'components')
        .filter((attempt) => attempt.scope === 'components-2'),
    ).toHaveLength(2);
    expect(api.loadExplorationRun(reopened, sessionId, 'components')?.status).toBe('failed');
    expect(() => api.loadAcceptedSlotDecisions(reopened, sessionId)).toThrow('stale or incomplete');
    expect(api.loadScopeComponents(reopened, sessionId)).toEqual([]);
    const artifact = join(
      dir,
      'exploration-artifacts',
      encodeURIComponent(sessionId),
      result.runId!,
      'components',
      'components-1.json',
    );
    expect(JSON.parse(readFileSync(artifact, 'utf8')).coverage).toEqual(reports[0]?.coverage);
  } finally {
    reopened.close();
  }
});
