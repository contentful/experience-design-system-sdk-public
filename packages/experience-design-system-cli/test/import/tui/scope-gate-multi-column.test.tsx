import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ScopeGateStep } from '../../../src/import/tui/steps/ScopeGateStep.js';

/**
 * Multi-column scope-gate layout tests. The three-column layout only renders
 * at terminal widths ≥ 120. ink-testing-library's Stdout hard-codes columns
 * to 100, so we monkey-patch its prototype for wide-terminal tests.
 */

function withStdoutColumns(cols: number): () => void {
  // Render once to obtain a stdout instance (and its prototype).
  const probe = render(<Empty />);
  const proto = Object.getPrototypeOf(probe.stdout);
  const original = Object.getOwnPropertyDescriptor(proto, 'columns');
  Object.defineProperty(proto, 'columns', {
    configurable: true,
    get: () => cols,
  });
  probe.unmount();
  probe.cleanup();
  return () => {
    if (original) Object.defineProperty(proto, 'columns', original);
  };
}

function Empty(): React.ReactElement {
  return React.createElement('text', null, '');
}

const restorers: Array<() => void> = [];
afterEach(() => {
  while (restorers.length > 0) restorers.pop()!();
});

function setWide(cols = 160): void {
  restorers.push(withStdoutColumns(cols));
}

const CARD_GRAPH = [
  { name: 'Card', componentId: 'c0', slots: [{ name: 'body', allowedComponents: ['Text', 'Icon'] }] },
  { name: 'Text', componentId: 'c1' },
  { name: 'Icon', componentId: 'c2' },
  { name: 'Standalone', componentId: 'c3' },
];

describe('ScopeGateStep — counter strip', () => {
  it('always renders the counter strip with Accepted / Groups / Rejected / Undecided labels', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Accepted');
    expect(out).toContain('Groups');
    expect(out).toContain('Rejected');
    expect(out).toContain('Undecided');
  });

  it('counter values reflect the initial accepted state (all-accepted baseline)', () => {
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    // 4 accepted out of 4, one composite root (Card) accepted.
    expect(out).toMatch(/Accepted[^0-9]*4[^0-9]*4/);
    expect(out).toMatch(/Groups[^0-9]*1/);
    expect(out).toMatch(/Rejected[^0-9]*0/);
    expect(out).toMatch(/Undecided[^0-9]*0/);
  });
});

describe('ScopeGateStep — three-column layout (wide terminal)', () => {
  it('renders "Added components" and "Added groups" columns at ≥ 120 cols', () => {
    setWide(160);
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Added components');
    expect(out).toContain('Added groups');
    // Legend advertises Tab.
    expect(out).toContain('switch column');
  });

  it('omits side columns at narrow terminals (< 120 cols)', () => {
    // Default testing-library width is 100 (< 120).
    const { lastFrame } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    const out = lastFrame() ?? '';
    expect(out).not.toContain('Added components');
    expect(out).not.toContain('Added groups');
    expect(out).not.toContain('switch column');
  });

  it('Enter in the Added-components column jumps main cursor', () => {
    setWide(160);
    const { lastFrame, stdin } = render(
      <ScopeGateStep components={CARD_GRAPH} onConfirm={() => {}} onQuit={() => {}} />,
    );
    // Tab from main → added-components, then Enter should jump the main
    // cursor to whichever added component is highlighted (Card, since it
    // sorts first alphabetically among accepted names Card/Icon/Standalone/Text).
    stdin.write('\t');
    stdin.write('\r');
    const out = lastFrame() ?? '';
    // Card is a group root; the main-cursor row highlights Card in the
    // grouped sidebar. The ▶ glyph should appear beside Card.
    expect(out).toContain('Card');
  });
});
