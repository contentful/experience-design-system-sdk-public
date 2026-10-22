import { beforeEach, expect, it, vi } from 'vitest';
import type {
  SourceCapture,
  SourceFactLocation,
  SourceReferenceIndex,
  SourceInputOutputEvidence,
} from '../../src/steps/extraction/index.js';
import type { CompletedSourceEvidence } from '../../src/persistence/src/session/repositories/db.js';
import { bindSavedSourceReferences } from '../../src/persistence/src/session/repositories/source-reference-binding.js';
import { validateSavedInputOutput } from '../../src/persistence/src/session/repositories/input-output-binding.js';

const canonical = vi.hoisted(() => vi.fn((path: string) => path));
vi.mock('../../src/steps/extraction/index.js', async (original) => ({
  ...(await original<typeof import('../../src/steps/extraction/index.js')>()),
  canonicalSourceFactPath: canonical,
}));
beforeEach(() => canonical.mockClear());
const files: SourceCapture['files'] = Array.from({ length: 50 }, (_, i) => ({
  fileId: `file-${i}`,
  canonicalPath: `/example/${i}.tsx`,
  displayPath: `${i}.tsx`,
  textHash: 'a'.repeat(64),
  captured: { kind: 'full', text: 'one\ntwo\n' },
  roles: [],
  componentRefs: [],
}));
const location: SourceFactLocation = {
  fileId: null,
  canonicalPath: files.at(-1)!.canonicalPath,
  textHash: 'a'.repeat(64),
  startLine: 2,
  endLine: 2,
  startOffset: 4,
  endOffset: 7,
  binding: 'unverified',
};
const index: SourceReferenceIndex = {
  schemaVersion: 1,
  semantics: 'lexical-reference-observations',
  componentDeclarationId: 'declaration',
  declaration: location,
  files: [],
  references: [],
  summaries: [],
  omissions: [],
  coverage: 'partial',
  limits: { maxNodes: 100, maxReferences: 100, maxFiles: 100, maxDepth: 10 },
  used: { nodes: 1, references: 0, files: 0, depth: 0 },
};
const evidence: SourceInputOutputEvidence = {
  schemaVersion: 1,
  semantics: 'bounded-source-dependencies',
  componentDeclarationId: 'declaration',
  coverage: 'partial',
  inputs: [{ name: 'label', rootSymbolId: 'root', declaration: location, parameterIndex: 0, inputPath: ['label'] }],
  witnesses: [],
  summaries: [],
  omissions: [],
  used: { nodes: 1, maxDepth: 0, witnesses: 0 },
};
const saved = { readiness: 'ready', envelope: { capture: { files } } } as CompletedSourceEvidence;

it('resolves a reference location once regardless of captured file count', () => {
  const result = bindSavedSourceReferences(index, files);
  expect(result.declaration).toMatchObject({ binding: 'verified', fileId: 'file-49' });
  expect(canonical).toHaveBeenCalledTimes(1);
});

it('resolves an input/output location once regardless of captured file count', () => {
  const result = validateSavedInputOutput(evidence, saved, true);
  expect(result.inputs[0]!.declaration).toMatchObject({ binding: 'verified', fileId: 'file-49' });
  expect(canonical).toHaveBeenCalledTimes(1);
});

it.each([
  { textHash: 'b'.repeat(64), expected: 'changed' },
  { startLine: 1, expected: 'unavailable' },
  { endOffset: 100, expected: 'unavailable' },
  { canonicalPath: '/example/missing.tsx', expected: 'unavailable' },
])('retains negative binding for $expected', ({ expected, ...change }) => {
  expect(
    bindSavedSourceReferences({ ...index, declaration: { ...location, ...change } }, files).declaration.binding,
  ).toBe(expected);
  const input = { ...evidence, inputs: [{ ...evidence.inputs[0]!, declaration: { ...location, ...change } }] };
  expect(validateSavedInputOutput(input, saved, true).inputs[0]!.declaration.binding).toBe(expected);
});

it('keeps input/output evidence unavailable when its closure is unverified', () => {
  expect(validateSavedInputOutput(evidence, saved, false).inputs[0]!.declaration.binding).toBe('unavailable');
});
