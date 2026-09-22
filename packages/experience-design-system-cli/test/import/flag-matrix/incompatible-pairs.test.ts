import { describe, it, expect } from 'vitest';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { IMPORT_FLAGS } from './flags.js';

const baseEnv = () => ({
  NODE_NO_WARNINGS: '1',
  CONTENTFUL_SPACE_ID: '',
  CONTENTFUL_ENVIRONMENT_ID: '',
  CONTENTFUL_MANAGEMENT_TOKEN: '',
});

interface RejectionCell {
  name: string;
  args: string[];
  expectStderr: RegExp;
}

const rejectionCells: RejectionCell[] = [
  {
    name: '--push-from-run ⊗ --modify',
    args: ['import', '--push-from-run', 'run-1', '--modify', 'run-2'],
    expectStderr: /--push-from-run and --modify are mutually exclusive/,
  },
  {
    name: '--push-from-run ⊗ --project',
    args: ['import', '--push-from-run', 'run-1', '--project', '/tmp/x'],
    expectStderr: /--push-from-run and --project are mutually exclusive/,
  },
  {
    name: '--push-from-run ⊗ --no-save',
    args: ['import', '--push-from-run', 'run-1', '--no-save'],
    expectStderr: /--push-from-run and --no-save are mutually exclusive/,
  },
  {
    name: '--push-from-run ⊗ --no-push',
    args: ['import', '--push-from-run', 'run-1', '--no-push'],
    expectStderr: /--push-from-run and --no-push are mutually exclusive/,
  },
  {
    name: '--push-from-run ⊗ --overwrite',
    args: ['import', '--push-from-run', 'run-1', '--overwrite'],
    expectStderr: /--overwrite and --save-as-new only apply with --modify/,
  },
  {
    name: '--push-from-run ⊗ --save-as-new',
    args: ['import', '--push-from-run', 'run-1', '--save-as-new'],
    expectStderr: /--overwrite and --save-as-new only apply with --modify/,
  },
  {
    name: '--modify ⊗ --project',
    args: ['import', '--modify', 'run-1', '--project', '/tmp/x'],
    expectStderr: /--modify and --project are mutually exclusive/,
  },
  {
    name: '--modify + --overwrite + --save-as-new',
    args: ['import', '--modify', 'run-1', '--overwrite', '--save-as-new'],
    expectStderr: /--overwrite and --save-as-new are mutually exclusive/,
  },
  {
    name: '--overwrite requires --modify',
    args: ['import', '--overwrite'],
    expectStderr: /--overwrite and --save-as-new require --modify/,
  },
  {
    name: '--save-as-new requires --modify',
    args: ['import', '--save-as-new'],
    expectStderr: /--overwrite and --save-as-new require --modify/,
  },
  {
    name: '--no-save ⊗ --no-push',
    args: ['import', '--no-save', '--no-push'],
    expectStderr: /--no-save and --no-push together would do nothing/,
  },
  {
    name: '--no-save ⊗ --out-dir',
    args: ['import', '--no-save', '--out-dir', '/tmp/x'],
    expectStderr: /--no-save and --out-dir are mutually exclusive/,
  },
  {
    name: '--no-save ⊗ --on-conflict',
    args: ['import', '--no-save', '--on-conflict', 'overwrite'],
    expectStderr: /--no-save and --on-conflict are mutually exclusive/,
  },
  {
    name: '--raw-tokens ⊗ --tokens',
    args: ['import', '--raw-tokens', '/tmp/raw.scss', '--tokens', '/tmp/t.json'],
    expectStderr: /--raw-tokens and --tokens are mutually exclusive/,
  },
];

describe('flag-matrix: incompatible flag pairs REJECT with exit 1 and the right message', () => {
  it.each(rejectionCells)('rejects $name', async ({ args, expectStderr }) => {
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(expectStderr);
  });

  // ── invalid --on-conflict value rejects before mode dispatch ───────────────
  it('rejects an invalid --on-conflict value', async () => {
    const { code, stderr } = await runCliWithEnv(['import', '--on-conflict', 'bogus'], baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/invalid --on-conflict value/);
  });

  // ── coverage guard: every declared incompatible pair has a rejection cell ──
  it('every incompatibleWith edge in the inventory is asserted by a rejection cell', () => {
    const covered = new Set<string>();
    for (const cell of rejectionCells) {
      const flagsInCell = cell.args.filter((a) => a.startsWith('--'));
      for (let i = 0; i < flagsInCell.length; i++) {
        for (let j = i + 1; j < flagsInCell.length; j++) {
          const pair = [flagsInCell[i], flagsInCell[j]].sort().join(' ⊗ ');
          covered.add(pair);
        }
      }
    }

    const declaredEdges = new Set<string>();
    for (const spec of IMPORT_FLAGS) {
      for (const other of spec.incompatibleWith) {
        declaredEdges.add([spec.flag, other].sort().join(' ⊗ '));
      }
    }

    // --composite/--atomic is a documented precedence, not a rejection, and is
    // intentionally not declared incompatible in the inventory.
    const uncovered = [...declaredEdges].filter((edge) => !covered.has(edge));
    expect(uncovered, `declared incompatible pairs lacking a rejection cell: ${uncovered.join(', ')}`).toEqual([]);
  });
});
