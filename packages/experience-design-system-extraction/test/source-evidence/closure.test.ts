import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureSourceEvidence } from '../../src/index.js';

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'source-closure-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'tsconfig.json'),
    '{\n// Supported configuration syntax\n"compilerOptions": {"baseUrl":".","paths":{"@ui/*":["src/*"]},},\n}',
  );
  const files = {
    'src/panel.tsx': 'export function Panel() { return <section />; }\nexport function Text() { return <span />; }\n',
    'src/index.ts': "export { Panel as Surface, Text } from './panel.js';\n",
    'src/app.tsx':
      "import { Surface as Region, Text } from '@ui/index';\nexport const Application = () => <Region renderBody={() => <Text />} />;\n",
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  return {
    files: Object.keys(files).map((path) => join(root, path)),
    components: [
      { componentId: 'panel', name: 'Panel', sourcePath: join(root, 'src/panel.tsx') },
      { componentId: 'text', name: 'Text', sourcePath: join(root, 'src/panel.tsx') },
    ],
  };
}
describe('captured shared source closure', () => {
  it('uses supported configuration syntax and retains incoming aliases/barrels/nested callback references for multiple owners', async () => {
    const input = fixture();
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: input.files,
      components: input.components,
    });
    expect(capture.resolution.some((edge) => edge.specifier === '@ui/index' && edge.outcome === 'resolved')).toBe(true);
    const application = capture.files.find((file) => file.displayPath === 'src/app.tsx')!;
    expect(application.componentRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentId: 'panel', roles: expect.arrayContaining(['application', 'reference']) }),
        expect.objectContaining({ componentId: 'text', roles: expect.arrayContaining(['application', 'reference']) }),
      ]),
    );
    const definition = capture.files.find((file) => file.displayPath === 'src/panel.tsx')!;
    expect(definition.componentRefs.map((ref) => ref.componentId)).toEqual(['panel', 'text']);
    expect(capture.files.filter((file) => file.canonicalPath === definition.canonicalPath)).toHaveLength(1);
    expect(capture.extractionByteBinding).toBe('unverified');
  });
  it('records a supplied export alias as a binding and retains its actual declaration file identity', async () => {
    const input = fixture();
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: input.files,
      components: [{ componentId: 'surface', name: 'Surface', sourcePath: join(root, 'src/index.ts') }],
    });
    expect(capture.files.find((file) => file.displayPath === 'src/index.ts')?.componentRefs).toContainEqual(
      expect.objectContaining({ componentId: 'surface', roles: expect.arrayContaining(['binding']) }),
    );
    expect(capture.files.find((file) => file.displayPath === 'src/panel.tsx')?.componentRefs).toContainEqual(
      expect.objectContaining({ componentId: 'surface', roles: expect.arrayContaining(['definition']) }),
    );
    expect(capture.files.find((file) => file.displayPath === 'src/index.ts')?.roles).not.toContain('definition');
  });
  it('resolves inherited relative options and multiple admitted config bases through TypeScript', async () => {
    const input = fixture();
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config/base.json'), '{"compilerOptions":{"baseUrl":"../src","paths":{"@ui/*":["*"]}}}');
    writeFileSync(join(root, 'config/strict.json'), '{"compilerOptions":{"strict":true}}');
    writeFileSync(join(root, 'tsconfig.json'), '{"extends":["./config/base.json","./config/strict.json"]}');
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: input.files,
      components: input.components,
    });
    expect(capture.resolution.find((edge) => edge.specifier === '@ui/index')?.outcome).toBe('resolved');
    expect(capture.files.filter((file) => file.roles.includes('config'))).toHaveLength(3);
    expect(capture.diagnostics.filter((item) => item.kind === 'config')).toEqual([]);
  });
  it('retains unsupported package config, resolver and reference budget outcomes', async () => {
    const input = fixture();
    writeFileSync(join(root, 'tsconfig.json'), '{"extends":"example-config/base"}');
    const unsupported = await captureSourceEvidence({
      projectRoot: root,
      filePaths: input.files,
      components: input.components,
    });
    expect(unsupported.diagnostics.some((item) => item.reason.startsWith('unsupported-package-config-extends:'))).toBe(
      true,
    );
    const bounded = await captureSourceEvidence({
      projectRoot: root,
      filePaths: input.files,
      components: input.components,
      limits: { maxResolverProbes: 1, maxReferenceNodes: 1 },
    });
    expect(bounded.coverage).toBe('partial');
    expect(bounded.diagnostics.some((item) => item.kind === 'budget')).toBe(true);
    expect(bounded.bounds.used.referenceNodes).toBeLessThanOrEqual(1);
  });
  it('deduplicates admitted symlinks and records source escapes without external expansion', async () => {
    const input = fixture();
    symlinkSync(join(root, 'src/panel.tsx'), join(root, 'src/linked.tsx'));
    const outside = mkdtempSync(join(tmpdir(), 'source-outside-'));
    try {
      writeFileSync(join(outside, 'foreign.ts'), 'export const Foreign = true;');
      symlinkSync(join(outside, 'foreign.ts'), join(root, 'src/foreign.ts'));
      const captured = await captureSourceEvidence({
        projectRoot: root,
        filePaths: [...input.files, join(root, 'src/linked.tsx'), join(root, 'src/foreign.ts')],
        components: input.components,
      });
      expect(captured.files.filter((file) => file.displayPath === 'src/panel.tsx')).toHaveLength(1);
      expect(captured.files.some((file) => file.canonicalPath.startsWith(outside))).toBe(false);
      expect(captured.diagnostics.some((item) => item.kind === 'excluded')).toBe(true);
      expect(captured.coverage).toBe('partial');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it('honors capture cancellation before admitting source', async () => {
    const input = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      captureSourceEvidence({ projectRoot: root, filePaths: input.files, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('associates admitted JavaScript and JSX without external compiler libraries', async () => {
    fixture();
    const definition = join(root, 'src/widget.jsx');
    const application = join(root, 'src/view.jsx');
    writeFileSync(definition, 'export const Widget = () => <section />;');
    writeFileSync(application, 'import { Widget } from "./widget.jsx"; export const View = () => <Widget />;');
    const capture = await captureSourceEvidence({
      projectRoot: root,
      filePaths: [definition, application],
      components: [{ componentId: 'widget', name: 'Widget', sourcePath: definition }],
    });
    expect(capture.files.find((file) => file.displayPath === 'src/view.jsx')?.componentRefs).toContainEqual(
      expect.objectContaining({ componentId: 'widget', roles: expect.arrayContaining(['application', 'reference']) }),
    );
    expect(capture.diagnostics.filter((item) => item.reason.startsWith('component-association'))).toEqual([]);
  });
});
