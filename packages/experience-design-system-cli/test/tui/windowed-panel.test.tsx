import React from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import {
  formatWindowIndicator,
  WindowIndicator,
  WindowedPanel,
  WindowedPanelHeader,
} from '../../src/tui/windowed-panel.js';

describe('formatWindowIndicator', () => {
  it.each([
    ['up', 3, '↑ 3 more'],
    ['down', 2, '↓ 2 more'],
  ] as const)('formats %s direction with %d hidden rows', (direction, count, expected) => {
    expect(formatWindowIndicator(direction, count)).toBe(expected);
  });

  it.each([0, -1])('returns a blank indicator for non-positive count %d', (count) => {
    expect(formatWindowIndicator('down', count)).toBe(' ');
  });
});

describe('WindowIndicator', () => {
  it('renders the formatted indicator', () => {
    expect(render(<WindowIndicator direction="up" count={4} />).lastFrame()).toBe('↑ 4 more');
  });
});

describe('WindowedPanelHeader', () => {
  it('renders the title and a separator sized to the panel width', () => {
    const output = render(<WindowedPanelHeader title="Components" width={12} focused={false} />).lastFrame();
    expect(output).toContain('Components');
    expect(output).toContain('──────────');
  });

  it('does not repeat the separator when the width is smaller than the border allowance', () => {
    const output = render(<WindowedPanelHeader title="X" width={1} focused={false} />).lastFrame();
    expect(output).toBe('X');
  });
});

describe('WindowedPanel', () => {
  it('renders a titled fixed-height panel and its children', () => {
    const output = render(
      <WindowedPanel width={24} height={5} title="Review" focused>
        <Box>
          <Text>content</Text>
        </Box>
      </WindowedPanel>,
    ).lastFrame();

    expect(output).toContain('Review');
    expect(output).toContain('content');
    expect(output?.split('\n')).toHaveLength(5);
  });

  it('renders an untitled panel without a header', () => {
    const output = render(
      <WindowedPanel width={12} focused={false}>
        <Text>body</Text>
      </WindowedPanel>,
    ).lastFrame();

    expect(output).toContain('body');
    expect(output?.split('\n')).toHaveLength(3);
  });
});
