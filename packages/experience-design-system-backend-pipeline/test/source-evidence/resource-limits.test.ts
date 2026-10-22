import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  captureSourceEvidence,
  DEFAULT_SOURCE_CAPTURE_LIMITS,
} from '../../src/steps/extraction/source-evidence/index.js';
import {
  discoverSourceEvidence,
  DEFAULT_SOURCE_DISCOVERY_LIMITS,
} from '../../src/steps/extraction/source-evidence/discovery.js';
import { readSourceInventory } from '../../src/steps/extraction/source-evidence/discovery-validation.js';
import {
  collectComponentSourceObservations,
  DEFAULT_COMPONENT_OBSERVATION_LIMITS,
} from '../../src/steps/extraction/src/component-facts/collect-component-source-observations.js';

let root: string;
let sourcePath: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'resource-limits-')));
  sourcePath = join(root, 'source.ts');
  writeFileSync(sourcePath, 'export function Surface(input: { value: string }) { return input.value; }');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const invalidLimits: Array<{ label: string; value: unknown }> = [
  { label: 'NaN', value: NaN },
  { label: 'infinity', value: Infinity },
  { label: 'negative infinity', value: -Infinity },
  { label: 'negative', value: -1 },
  { label: 'unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'undefined', value: undefined },
  { label: 'string', value: '4' },
  { label: 'null', value: null },
];

it.each(invalidLimits)(
  'retains finite capture defaults for $label instead of disabling its bound',
  async ({ value }) => {
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [sourcePath],
      evidenceFilePaths: [],
      limits: { maxFiles: value as number, maxReferenceNodes: value as number },
    });
    expect(capture.bounds.limits.maxFiles).toBe(DEFAULT_SOURCE_CAPTURE_LIMITS.maxFiles);
    expect(capture.bounds.limits.maxReferenceNodes).toBe(DEFAULT_SOURCE_CAPTURE_LIMITS.maxReferenceNodes);
    expect(capture.files.find((file) => file.canonicalPath === sourcePath)?.captured.kind).toBe('full');
  },
);

it.each(invalidLimits)('keeps discovery evidence readable after a $label override', ({ value }) => {
  const inventory = discoverSourceEvidence({
    projectRoot: root,
    filePaths: [sourcePath],
    evidenceFilePaths: [],
    limits: { maxFiles: value as number },
  });
  expect(inventory.bounds.limits.maxFiles).toBe(DEFAULT_SOURCE_DISCOVERY_LIMITS.maxFiles);
  expect(readSourceInventory(inventory).status).toBe('available');
});

it.each(invalidLimits)('keeps compiler indexing finite after a $label override', ({ value }) => {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const source = project.createSourceFile(
    '/example/source.ts',
    'function Surface(input: {value: string}) { return input.value; }',
  );
  const observations = collectComponentSourceObservations(source.getFunctionOrThrow('Surface'), {
    limits: { maxNodes: value as number },
  });
  expect(observations.limits.maxNodes).toBe(DEFAULT_COMPONENT_OBSERVATION_LIMITS.maxNodes);
});

it('honors zero and fractional bounds with explicit incomplete coverage', async () => {
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [sourcePath],
    evidenceFilePaths: [],
    limits: { maxFiles: 0, maxReferenceNodes: 1.9 },
  });
  expect(capture.bounds.limits).toMatchObject({ maxFiles: 0, maxReferenceNodes: 1 });
  expect(capture.bounds.used.files).toBe(0);
  expect(capture.coverage).not.toBe('complete-within-declared-bound');
  expect(capture.diagnostics).toContainEqual({ kind: 'budget', reason: 'max-files' });
});
