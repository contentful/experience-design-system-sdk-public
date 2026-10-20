import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { scanFiles } from '../../../src/tui/import/steps/03-path-validation/helpers/scan-files.js';

it('keeps real wizard selected files independent of admitted story/test/example evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'wizard-discovery-'));
  try {
    mkdirSync(join(root, 'examples'));
    writeFileSync(join(root, 'Surface.tsx'), 'export const Surface=()=> <section/>;');
    writeFileSync(join(root, 'Surface.test.tsx'), 'export const Test=()=> <Surface/>;');
    writeFileSync(join(root, 'examples', 'Caller.tsx'), 'export const Example=()=> <Surface/>;');
    const scan = scanFiles(root);
    expect(scan.ok).toBe(true);
    if (!scan.ok) throw new Error('scan failed');
    expect(scan.filePaths.some((path) => path.endsWith('Surface.test.tsx'))).toBe(false);
    expect(scan.sourceInventory).toBeDefined();
    expect(scan.sourceInventory!.files.some((file) => file.canonicalPath.endsWith('Surface.test.tsx'))).toBe(true);
    expect(scan.sourceInventory!.files.some((file) => file.canonicalPath.includes('/examples/Caller.tsx'))).toBe(true);
    expect(scan.sourceInventory!.selectedSourcePaths.every((path) => !path.endsWith('Surface.test.tsx'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
