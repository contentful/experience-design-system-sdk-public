import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents, captureSourceEvidence } from '../../src/steps/extraction/index.js';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  loadCompletedSourceEvidence,
  loadRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { runSourceAnalysis } from '../../src/source-analysis/run.js';
import { collectSourceCallSiteEvidence } from '../../src/steps/composition/src/helpers/edges/source-call-site-evidence.js';
import { readCompositionFiles } from '../../src/orchestrators/run-extract-and-compose-session/helpers/read-composition-files.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

async function fixture(maxResolverProbes?: number) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'source-publication-')));
  roots.push(root);
  const source = join(root, 'Surface.tsx');
  const caller = join(root, 'Caller.tsx');
  const files = [
    { path: source, content: 'export const Surface = ({label}: {label: string}) => <section>{label}</section>;' },
    { path: caller, content: 'import {Surface} from "./Surface"; export const Caller=()=> <Surface label="saved"/>;' },
  ];
  files.forEach((file) => writeFileSync(file.path, file.content));
  const extracted = await extractReactComponents([source], undefined, {
    projectRoot: root,
    evidenceFilePaths: [caller],
  });
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [source],
    evidenceFilePaths: [caller],
    compilerSources: extracted.compilerSources,
    inventory: extracted.sourceInventory,
    components: [{ componentId: 'Surface', name: 'Surface', sourcePath: source }],
    ...(maxResolverProbes !== undefined ? { limits: { maxResolverProbes } } : {}),
  });
  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = createStep(db, sessionId, 'analyze extract', {});
  db.close();
  const observations = collectSourceCallSiteEvidence(files, extracted.components);
  return {
    dbPath,
    extraction: {
      sessionId,
      stepId,
      components: extracted.components,
      cycles: [],
      scannedFiles: [source],
      capture,
      observations,
    },
  };
}

it('keeps timers responsive while publishing a complete, reopenable source snapshot', async () => {
  const input = await fixture();
  const heartbeat = new Promise<string>((resolve) => setTimeout(() => resolve('heartbeat'), 0));
  const publication = runSourceAnalysis('publishExtraction', input);
  expect(await Promise.race([publication.then(() => 'published'), heartbeat])).toBe('heartbeat');
  const handle = await publication;
  const db = openPipelineDb(input.dbPath);
  try {
    const saved = loadCompletedSourceEvidence(db, input.extraction.sessionId, handle);
    expect(saved.readiness).toBe('ready');
    expect(loadRawComponents(db, input.extraction.sessionId).map((component) => component.name)).toEqual(['Surface']);
    expect(db.prepare('SELECT status FROM steps WHERE id=?').get(input.extraction.stepId)).toMatchObject({
      status: 'complete',
    });
    expect(input.extraction.observations.accepted).toHaveLength(1);
    expect(
      db
        .prepare(
          "SELECT json_array_length(payload_json,'$.observations.accepted') AS count FROM session_source_envelopes WHERE session_id=?",
        )
        .get(input.extraction.sessionId),
    ).toMatchObject({ count: 1 });
  } finally {
    db.close();
  }
});

it('rejects invalid publication without publishing component rows or completing the extraction step', async () => {
  const input = await fixture();
  input.extraction.components[0]!.componentFacts!.sourceObservations!.referenceIndex!.used.references++;
  await expect(runSourceAnalysis('publishExtraction', input)).rejects.toThrow(
    'Invalid completed source reference index',
  );
  const db = openPipelineDb(input.dbPath);
  try {
    expect(loadRawComponents(db, input.extraction.sessionId)).toEqual([]);
    expect(db.prepare('SELECT status FROM steps WHERE id=?').get(input.extraction.stepId)).toMatchObject({
      status: 'pending',
    });
    expect(
      db
        .prepare('SELECT count(*) AS count FROM session_source_envelopes WHERE session_id=?')
        .get(input.extraction.sessionId),
    ).toMatchObject({ count: 0 });
  } finally {
    db.close();
  }
});

it('preserves caller bytes for configured composition when configuration resolution exhausts its budget', async () => {
  const input = await fixture(0);
  const files = await readCompositionFiles(
    input.extraction.components,
    input.extraction.scannedFiles,
    input.extraction.capture,
  );
  expect(files.some((file) => file.path.endsWith('Caller.tsx'))).toBe(true);
  expect(collectSourceCallSiteEvidence(files, input.extraction.components).accepted).toHaveLength(1);
  expect(input.extraction.capture.coverage).toBe('partial');
});
