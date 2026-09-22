import { render } from 'ink-testing-library';
import { Box } from 'ink';
import { describe, it, expect } from 'vitest';
import { legendEntry } from '../../../src/import/tui/components/LegendEntry.js';
import { PALETTE } from '../../../src/analyze/select/tui/theme.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('legendEntry (L11 atomic legend helper)', () => {
  it('renders the key and label adjacent as one unit', () => {
    const { lastFrame } = render(<Box>{legendEntry('[w]', 'broken')}</Box>);
    expect(stripAnsi(lastFrame() ?? '')).toContain('[w] broken');
  });

  it('active entry marks the key Text node inverse + yellow (mirrors L8)', () => {
    const active = legendEntry('[o]', 'only cycles', true);
    const inactive = legendEntry('[o]', 'only cycles', false);
    const keyNode = (active.props.children as React.ReactElement[])[0];
    expect(keyNode.props.inverse).toBe(true);
    expect(keyNode.props.color).toBe(PALETTE.warning);
    const inactiveKey = (inactive.props.children as React.ReactElement[])[0];
    expect(inactiveKey.props.inverse).toBe(false);
    expect(inactiveKey.props.color).toBe(PALETTE.info);
  });

  it('is a single flex item so key + label never split across a wrap', () => {
    // The helper returns exactly ONE outer <Text> element — one flex item —
    // so a wrapping parent Box cannot break between the key and its label.
    const el = legendEntry('[w]', 'broken');
    expect(el.type).toBeDefined();
    expect(Array.isArray(el.props.children)).toBe(true);
    expect((el.props.children as unknown[]).length).toBe(2);
    const { lastFrame } = render(
      <Box width={12} flexWrap="wrap">
        {legendEntry('[w]', 'broken')}
        {legendEntry('[o]', 'cycles')}
      </Box>,
    );
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('[w] broken');
    expect(frame).toContain('[o] cycles');
  });
});
