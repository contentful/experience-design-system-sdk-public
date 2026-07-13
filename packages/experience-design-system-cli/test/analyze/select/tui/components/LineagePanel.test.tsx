import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { LineagePanel } from '../../../../../src/analyze/select/tui/components/LineagePanel.js';
import type {
  LineageEntry,
  LineageJumpable,
} from '../../../../../src/import/tui/hooks/useLineage.js';

function buildEntries(descendantCount: number): {
  entries: LineageEntry[];
  jumpables: LineageJumpable[];
} {
  const entries: LineageEntry[] = [
    { kind: 'section', label: 'Ancestors:' },
    { kind: 'empty', label: '  (no ancestors)' },
    { kind: 'section', label: 'Descendants:' },
  ];
  for (let i = 0; i < descendantCount; i++) {
    entries.push({ kind: 'descendant', label: `  Descendant${i}`, jumpTarget: `Descendant${i}` });
  }
  const jumpables: LineageJumpable[] = entries
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.kind === 'ancestor' || entry.kind === 'descendant');
  return { entries, jumpables };
}

function countEntryLines(frame: string): number {
  return frame.split('\n').filter((l) => /Descendant\d/.test(l)).length;
}

describe('LineagePanel windowing', () => {
  it('renders a bounded number of entry lines for a large lineage (not all 40)', () => {
    const { entries, jumpables } = buildEntries(40);
    const { lastFrame } = render(
      <LineagePanel focusedComponentKey="InnerA" entries={entries} cursor={0} jumpables={jumpables} />,
    );
    const out = lastFrame() ?? '';
    const lines = countEntryLines(out);
    expect(lines).toBeGreaterThan(0);
    expect(lines).toBeLessThan(40);
  });

  it('keeps the cursor row visible as the cursor moves toward the end', () => {
    const { entries, jumpables } = buildEntries(40);
    // cursor 0 -> first descendants shown, last not shown
    const first = render(
      <LineagePanel focusedComponentKey="InnerA" entries={entries} cursor={0} jumpables={jumpables} />,
    );
    const firstOut = first.lastFrame() ?? '';
    expect(firstOut).toContain('Descendant0');
    expect(firstOut).not.toContain('Descendant39');

    // cursor near the end -> last descendant (incl. cursor) shown, first not
    const lastIdx = jumpables.length - 1; // Descendant39
    const last = render(
      <LineagePanel focusedComponentKey="InnerA" entries={entries} cursor={lastIdx} jumpables={jumpables} />,
    );
    const lastOut = last.lastFrame() ?? '';
    expect(lastOut).toContain('Descendant39');
    expect(lastOut).not.toContain('Descendant0');
  });

  it('constrains the panel box to an explicit width when given', () => {
    const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
    const { entries, jumpables } = buildEntries(3);
    const width = 34;
    const out =
      render(
        <LineagePanel
          focusedComponentKey="InnerA"
          entries={entries}
          cursor={0}
          jumpables={jumpables}
          width={width}
        />,
      ).lastFrame() ?? '';
    const lines = strip(out).split('\n');
    const border = lines.find((l) => l.includes('┌'));
    expect(border).toBeDefined();
    // The bordered box spans exactly `width` columns (border-to-border).
    expect((border ?? '').length).toBe(width);
  });

  it('shows scroll affordance indicators only when content overflows', () => {
    const big = buildEntries(40);
    const bigOut =
      render(
        <LineagePanel
          focusedComponentKey="InnerA"
          entries={big.entries}
          cursor={big.jumpables.length - 1}
          jumpables={big.jumpables}
        />,
      ).lastFrame() ?? '';
    // When scrolled to the bottom there must be a "more above" indicator.
    expect(bigOut).toMatch(/more/);

    const small = buildEntries(3);
    const smallOut =
      render(
        <LineagePanel
          focusedComponentKey="InnerA"
          entries={small.entries}
          cursor={0}
          jumpables={small.jumpables}
        />,
      ).lastFrame() ?? '';
    // Small lineage renders fully with no scroll indicators.
    expect(countEntryLines(smallOut)).toBe(3);
    expect(smallOut).not.toMatch(/more/);
  });
});
