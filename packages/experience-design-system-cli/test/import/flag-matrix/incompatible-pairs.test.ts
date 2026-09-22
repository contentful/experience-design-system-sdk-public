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

const rejectionCells: RejectionCell[] = [];

describe('flag-matrix: incompatible flag pairs REJECT with exit 1 and the right message', () => {
  it.each(rejectionCells)('rejects $name', async ({ args, expectStderr }) => {
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(expectStderr);
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
