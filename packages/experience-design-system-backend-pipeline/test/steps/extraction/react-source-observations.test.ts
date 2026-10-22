import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Node } from 'ts-morph';
import { extractReactComponents as publicReact } from '../../../src/steps/extraction/index.js';
import { extractReactComponents } from '../../../src/steps/extraction/src/framework-adapters/react/extract-react-components.js';

const roots: string[] = [];
afterEach(() => vi.restoreAllMocks());
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture(source: string): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'react-observations-')));
  roots.push(root);
  const path = join(root, 'Example.tsx');
  writeFileSync(path, source);
  return path;
}

it('shares source binding observations beside useful declared props without changing authoring projection', async () => {
  const path = fixture(
    `type Props = { label: 'first' | 'second'; count: any }; export function Example({ label = 'first', count, extra = false }: Props) { return <button disabled={extra}>{label}{count}</button>; }`,
  );
  const direct = await publicReact([path]);
  const result = await extractReactComponents([path]);
  const actual = result.components[0]!;
  const expected = direct.components[0]!;
  expect(actual.sourceCandidates).toEqual(expected.sourceCandidates);
  expect(actual.props.map((prop) => prop.name)).toEqual(['count', 'label']);
  expect(actual.sourceCandidates?.find((candidate) => candidate.name === 'extra')).toMatchObject({
    evidenceKinds: ['binding'],
    projection: { kind: 'excluded' },
    sourceDefault: 'false',
  });
  const label = actual.sourceCandidates?.find((candidate) => candidate.name === 'label');
  expect(label?.facts).toMatchObject({
    declaredRequired: true,
    sourceTypeText: "'first' | 'second'",
    domain: { openness: 'closed' },
    sourceDefault: { expression: "'first'" },
  });
  expect(label?.evidenceKinds).toContain('binding');
});

it('reports truncated source candidate counts through both actual React producers', async () => {
  const path = fixture(
    `type Props = { ${Array.from({ length: 2051 }, (_, index) => `field${index}: string`).join(';')} }; export function Example(props: Props) { return <div/>; }`,
  );
  for (const extract of [publicReact, extractReactComponents]) {
    const result = await extract([path]);
    expect(result.components[0]?.sourceCandidates).toHaveLength(2048);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ outcome: 'unavailable', reason: 'source-candidate-budget-exhausted:3' }),
    );
    expect(result.extractionDiagnostics?.used.sourceCandidatesOmitted).toBe(3);
  }
});

it('checks cancellation between eligible source files on both actual producers', async () => {
  const first = fixture(`type Props = { label: string }; export function First(props: Props) { return <div/>; }`);
  const second = join(first, '..', 'Second.tsx');
  writeFileSync(second, `type Props = { label: string }; export function Second(props: Props) { return <div/>; }`);
  for (const extract of [publicReact, extractReactComponents]) {
    const controller = new AbortController();
    const original = Node.prototype.getType;
    vi.spyOn(Node.prototype, 'getType').mockImplementation(function (this: Node) {
      if (this.getSourceFile().getFilePath() === first) controller.abort();
      return original.call(this);
    });
    const result = await extract([first, second], undefined, { signal: controller.signal });
    expect(result.components.map((component) => component.name)).toEqual(['First']);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'compiler-analysis-cancelled' }),
    );
    vi.restoreAllMocks();
  }
});

it('retains explicit parse uncertainty when a malformed source emits no components', async () => {
  const path = fixture(`export function Example(props: { label: string }) { return <div>; }`);
  for (const extract of [publicReact, extractReactComponents]) {
    const result = await extract([path]);
    expect(result.components).toEqual([]);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'compiler-source-parse-failed' }),
    );
  }
});
