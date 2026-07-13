import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import {
  GotoBanner,
  type GotoRow,
} from '../../../../../src/analyze/select/tui/components/GotoBanner.js';

function buildRows(count: number): GotoRow[] {
  const rows: GotoRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ label: `Target${i}`, jumpTarget: `Target${i}` });
  }
  return rows;
}

function countRowLines(frame: string): number {
  return frame.split('\n').filter((l) => /Target\d/.test(l)).length;
}

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('GotoBanner', () => {
  it('renders the title', () => {
    const out =
      render(
        <GotoBanner title="Breaking changes" rows={buildRows(3)} cursor={0} />,
      ).lastFrame() ?? '';
    expect(out).toContain('Breaking changes');
  });

  it('marks the highlighted row by cursor with a ▶ pointer', () => {
    const out =
      render(
        <GotoBanner title="Goto" rows={buildRows(3)} cursor={1} />,
      ).lastFrame() ?? '';
    const lines = out.split('\n');
    const cursorLine = lines.find((l) => l.includes('Target1'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine ?? '').toContain('▶');
    // Non-cursor rows have no pointer.
    const otherLine = lines.find((l) => l.includes('Target0'));
    expect(otherLine ?? '').not.toContain('▶');
  });

  it('renders the footer hint when given', () => {
    const out =
      render(
        <GotoBanner
          title="Goto"
          rows={buildRows(3)}
          cursor={0}
          footerHint="[↑/↓] move · [Enter] jump · [x/Esc] close"
        />,
      ).lastFrame() ?? '';
    expect(out).toContain('[Enter] jump');
  });

  it('windows rows to maxRows with ▲/▼ more indicators on overflow', () => {
    const rows = buildRows(40);
    // Cursor at the end: rows before it are windowed off -> "more above".
    const out =
      render(
        <GotoBanner title="Goto" rows={rows} cursor={39} maxRows={10} />,
      ).lastFrame() ?? '';
    expect(countRowLines(out)).toBeLessThan(40);
    expect(countRowLines(out)).toBeGreaterThan(0);
    expect(out).toContain('Target39');
    expect(out).not.toContain('Target0');
    expect(out).toMatch(/more/);
  });

  it('renders every row with no indicators when content fits', () => {
    const out =
      render(
        <GotoBanner title="Goto" rows={buildRows(3)} cursor={0} maxRows={15} />,
      ).lastFrame() ?? '';
    expect(countRowLines(out)).toBe(3);
    expect(out).not.toMatch(/more/);
  });

  it('constrains the box to an explicit width', () => {
    const width = 34;
    const out =
      render(
        <GotoBanner title="Goto" rows={buildRows(3)} cursor={0} width={width} />,
      ).lastFrame() ?? '';
    const lines = strip(out).split('\n');
    const border = lines.find((l) => l.includes('┌'));
    expect(border).toBeDefined();
    expect((border ?? '').length).toBe(width);
  });
});
