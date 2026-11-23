import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createObservedCompilerFileSystem,
  CompilerSnapshotError,
} from '../../../../../src/steps/extraction/src/compiler/observed-file-system.js';

const roots: string[] = [];
function fixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'compiler-snapshot-')));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('compiler filesystem snapshot replay', () => {
  it('replays immutable successful reads/probes/directories and failures without extra counters or live reads', () => {
    const root = fixture();
    const source = join(root, 'View.ts');
    const missing = join(root, 'missing.ts');
    writeFileSync(source, 'export const View = 1;');
    const observed = createObservedCompilerFileSystem(root);
    const collect = () => {
      const result: unknown[] = [
        observed.host.fileExistsSync(source),
        observed.host.directoryExistsSync(root),
        observed.host.readFileSync(source),
        observed.host.readDirSync(root),
        observed.host.realpathSync(source),
      ];
      try {
        observed.host.readFileSync(missing);
      } catch (error) {
        result.push((error as Error).message);
      }
      return result;
    };
    const captured = observed.captureSnapshot(collect);
    const counters = { ...observed.used };
    const receipts = observed.reads.slice();
    writeFileSync(source, 'export const View = 2;');
    writeFileSync(missing, 'now available');
    expect(observed.replaySnapshot(captured.snapshot, collect)).toEqual(captured.value);
    expect(observed.used).toEqual(counters);
    expect(observed.reads).toEqual(receipts);
    expect(Object.isFrozen(captured.snapshot.operations)).toBe(true);
  });

  it('refuses reordered, missing and extra replay operations even if an action catches the mismatch', () => {
    const root = fixture();
    const observed = createObservedCompilerFileSystem(root);
    const captured = observed.captureSnapshot(() => observed.host.directoryExistsSync(root));
    expect(() => observed.replaySnapshot(captured.snapshot, () => undefined)).toThrow(CompilerSnapshotError);
    expect(() =>
      observed.replaySnapshot(captured.snapshot, () => {
        try {
          observed.host.fileExistsSync(root);
        } catch {
          /* The phase must still fail. */
        }
      }),
    ).toThrow(CompilerSnapshotError);
    expect(() =>
      observed.replaySnapshot(captured.snapshot, () => {
        observed.host.directoryExistsSync(root);
        observed.host.directoryExistsSync(root);
      }),
    ).toThrow(CompilerSnapshotError);
  });

  it('fails explicitly at its declared metadata capacity rather than publishing an incomplete snapshot', () => {
    const root = fixture();
    const observed = createObservedCompilerFileSystem(root);
    expect(() =>
      observed.captureSnapshot(() => {
        for (let index = 0; index < 3_000; index++) {
          try {
            observed.host.fileExistsSync(join(root, 'x'.repeat(4_096), String(index)));
          } catch {
            /* Swallowing an individual host failure must not admit this phase. */
          }
        }
      }),
    ).toThrow('Compiler snapshot replay metadata exceeds declared capacity');
  });
});
