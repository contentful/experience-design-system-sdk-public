import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dumpRawAst, type TsMorphAstNode } from '../../src/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'raw-ast-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(join(filePath, '..'), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

/** Recursively collect every SyntaxKind name present in a serialized ts-morph tree. */
function collectKinds(node: TsMorphAstNode, acc: Set<string> = new Set()): Set<string> {
  acc.add(node.kind);
  for (const child of node.children) collectKinds(child, acc);
  return acc;
}

/** Recursively collect the text of every node whose kind matches. */
function collectTextByKind(node: TsMorphAstNode, kind: string, acc: string[] = []): string[] {
  if (node.kind === kind) acc.push(node.text);
  for (const child of node.children) collectTextByKind(child, kind, acc);
  return acc;
}

describe('dumpRawAst', () => {
  it('dumps a ts-morph tree with structure + text fidelity', async () => {
    const filePath = await writeFixture(
      'Button.tsx',
      `interface ButtonProps { label: string }
       export function Button({ label }: ButtonProps) { return <button>{label}</button>; }`,
    );

    const dump = await dumpRawAst([filePath]);

    expect(dump.files).toHaveLength(1);
    const [file] = dump.files;
    expect(file.parser).toBe('ts-morph');
    expect(file.warnings).toEqual([]);

    const root = file.ast as TsMorphAstNode;
    expect(root.kind).toBe('SourceFile');
    const kinds = collectKinds(root);
    expect(kinds.has('InterfaceDeclaration')).toBe(true);
    expect(kinds.has('FunctionDeclaration')).toBe(true);
    // text fidelity: the full source text is preserved on the root node
    expect(root.text).toContain('ButtonProps');
    expect(root.text).toContain('<button>');
  });

  it('surfaces things the component extractors deliberately drop (NO filtering)', async () => {
    // Hooks, non-exported helpers, lowercase functions, and private/underscore
    // identifiers are all dropped by the react extractor. The raw dump must keep
    // every one of them.
    const filePath = await writeFixture(
      'mixed.tsx',
      `export function useThing() { return 1; }           // hook — extractor drops
       function internalHelper() { return 2; }            // not exported — extractor drops
       export const lowercaseThing = () => 3;             // lowercase — extractor drops
       export function Widget({ _private }: { _private: string }) { return <div>{_private}</div>; }`,
    );

    const dump = await dumpRawAst([filePath]);
    const root = dump.files[0].ast as TsMorphAstNode;

    const fnNames = [
      ...collectTextByKind(root, 'FunctionDeclaration'),
      ...collectTextByKind(root, 'VariableStatement'),
    ].join('\n');

    expect(fnNames).toContain('useThing');
    expect(fnNames).toContain('internalHelper');
    expect(fnNames).toContain('lowercaseThing');
    expect(fnNames).toContain('_private');
  });

  it('does not apply the extractors fileFilter exclusions (.d.ts is included)', async () => {
    const dts = await writeFixture('types.d.ts', `export interface Foo { bar: string }`);

    const dump = await dumpRawAst([dts]);

    expect(dump.files).toHaveLength(1);
    expect(dump.files[0].parser).toBe('ts-morph');
    const root = dump.files[0].ast as TsMorphAstNode;
    expect(collectKinds(root).has('InterfaceDeclaration')).toBe(true);
  });

  it('routes .vue files to the Vue SFC parser and returns the descriptor', async () => {
    const filePath = await writeFixture(
      'Card.vue',
      `<script setup lang="ts">defineProps<{ title: string }>()</script>
       <template><div>{{ title }}</div></template>`,
    );

    const dump = await dumpRawAst([filePath]);
    const [file] = dump.files;

    expect(file.parser).toBe('vue-sfc');
    const descriptor = file.ast as { scriptSetup?: { content: string }; template?: { content: string } };
    expect(descriptor.scriptSetup?.content).toContain('defineProps');
    expect(descriptor.template?.content).toContain('title');
  });

  it('routes .svelte files to the Svelte compiler', async () => {
    const filePath = await writeFixture(
      'Note.svelte',
      `<script lang="ts">let { text }: { text: string } = $props();</script><p>{text}</p>`,
    );

    const dump = await dumpRawAst([filePath]);
    const [file] = dump.files;

    expect(file.parser).toBe('svelte');
    expect(file.ast).not.toBeNull();
    // Svelte modern AST has a top-level `html`/`fragment` + `instance` shape.
    expect(JSON.stringify(file.ast)).toContain('text');
  });

  it('routes .astro files: frontmatter parsed as ts-morph, template preserved', async () => {
    const filePath = await writeFixture(
      'Hero.astro',
      `---
       interface Props { heading: string }
       const { heading } = Astro.props;
       ---
       <h1>{heading}</h1>`,
    );

    const dump = await dumpRawAst([filePath]);
    const [file] = dump.files;

    expect(file.parser).toBe('astro');
    const ast = file.ast as { frontmatter: TsMorphAstNode | null; template: string };
    expect(ast.frontmatter).not.toBeNull();
    expect(collectKinds(ast.frontmatter as TsMorphAstNode).has('InterfaceDeclaration')).toBe(true);
    expect(ast.template).toContain('<h1>');
  });

  it('produces JSON-serialisable output (no cyclic parent refs)', async () => {
    const filePath = await writeFixture('a.tsx', `export const A = () => <div />;`);
    const dump = await dumpRawAst([filePath]);
    expect(() => JSON.stringify(dump)).not.toThrow();
  });

  it('warns (does not throw) on an unsupported extension', async () => {
    const filePath = await writeFixture('styles.css', `.a { color: red; }`);
    const dump = await dumpRawAst([filePath]);

    expect(dump.files).toHaveLength(0);
    expect(dump.warnings.join('\n')).toContain('No AST parser');
  });

  it('returns files sorted by path for determinism', async () => {
    const b = await writeFixture('b.tsx', `export const B = () => <div />;`);
    const a = await writeFixture('a.tsx', `export const A = () => <div />;`);

    const dump = await dumpRawAst([b, a]);
    const paths = dump.files.map((f) => f.filePath);
    expect(paths).toEqual([...paths].sort((x, y) => x.localeCompare(y)));
  });
});
