import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { GroupedSidebar, type GroupedSidebarItem } from '../../../../src/analyze/select/tui/components/GroupedSidebar.js';
import type { NodeStatus } from '../../../../src/analyze/composite-closure.js';

/** Build a minimal review-entry-like item for the sidebar. */
function item(
  key: string,
  opts: {
    slots?: Record<string, string[]>;
    properties?: string[];
    status?: NodeStatus;
  } = {},
): GroupedSidebarItem {
  const entry: CDFComponentEntry = {
    $type: 'component',
    $properties: Object.fromEntries(
      (opts.properties ?? ['x']).map((p) => [p, { $type: 'text', $category: 'content' }]),
    ) as CDFComponentEntry['$properties'],
    $slots: Object.fromEntries(
      Object.entries(opts.slots ?? {}).map(([slotName, allowed]) => [
        slotName,
        { $allowedComponents: allowed },
      ]),
    ),
  };
  return {
    key,
    entry,
    status: opts.status ?? 'ok',
  };
}

function renderSidebar(overrides: Partial<React.ComponentProps<typeof GroupedSidebar>> = {}) {
  const defaults: React.ComponentProps<typeof GroupedSidebar> = {
    items: [],
    cycleParticipants: new Set<string>(),
    selectedIdx: 0,
    onSelect: vi.fn(),
    expandedGroups: new Set<string>(),
    onToggleExpanded: vi.fn(),
    width: 40,
    focused: true,
  };
  return render(<GroupedSidebar {...defaults} {...overrides} />);
}

describe('GroupedSidebar', () => {
  it('renders empty sidebar when items is empty', () => {
    const { lastFrame } = renderSidebar({ items: [] });
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('▸');
    expect(frame).not.toContain('▾');
  });

  it('renders a lone standalone (no deps, not a dep) as a flat row at bottom', () => {
    // Zero-dep component with no dependents -> standalone tier, flat row.
    const { lastFrame } = renderSidebar({
      items: [item('Widget')],
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Widget');
    expect(frame).not.toContain('▸');
    expect(frame).not.toContain('▾');
    expect(frame).not.toContain('├─');
  });

  it('two independent zero-dep components render as standalones alphabetically', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Bravo'), item('Alpha')],
    });
    const frame = lastFrame() ?? '';
    const aIdx = frame.indexOf('Alpha');
    const bIdx = frame.indexOf('Bravo');
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(frame).not.toContain('▸');
  });

  it('root with one dep renders as collapsed group with dep count', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Card', { slots: { body: ['Heading'] } }), item('Heading')],
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▸ Card');
    expect(frame).toMatch(/Card.*\(1 dep\)/);
    // Heading is a dep of Card, so it is NOT shown as a standalone.
    // Collapsed => Heading not visible.
    expect(frame).not.toContain('Heading');
  });

  it('when root is expanded, renders children with tree glyphs', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Card', { slots: { body: ['Heading'] } }), item('Heading')],
      expandedGroups: new Set(['Card']),
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▾ Card');
    expect(frame).toContain('└─ Heading');
  });

  it('diamond A->B, A->C, B->D, C->D dedups D under A when expanded', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('A', { slots: { s1: ['B'], s2: ['C'] } }),
        item('B', { slots: { x: ['D'] } }),
        item('C', { slots: { x: ['D'] } }),
        item('D'),
      ],
      expandedGroups: new Set(['A']),
    });
    const frame = lastFrame() ?? '';
    // D shows exactly once under A.
    const dMatches = frame.match(/\bD\b/g) ?? [];
    expect(dMatches.length).toBe(1);
  });

  it('depth cap of 2: A->B->C->D hides D behind +N more', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('A', { slots: { s: ['B'] } }),
        item('B', { slots: { s: ['C'] } }),
        item('C', { slots: { s: ['D'] } }),
        item('D'),
      ],
      expandedGroups: new Set(['A']),
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
    // D is depth 3, beyond cap; hidden behind +N more marker.
    expect(frame).not.toMatch(/[│├└─ ]D\b/);
    expect(frame).toMatch(/\+\d+ more/);
  });

  it('cycle participants render as flat rows at TOP with ⚠', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('Card', { slots: { s: ['Media'] } }),
        item('Media', { slots: { s: ['Card'] } }),
        item('Widget'),
      ],
      cycleParticipants: new Set(['Card', 'Media']),
    });
    const frame = lastFrame() ?? '';
    const cardIdx = frame.indexOf('Card');
    const mediaIdx = frame.indexOf('Media');
    const widgetIdx = frame.indexOf('Widget');
    expect(cardIdx).toBeGreaterThanOrEqual(0);
    expect(mediaIdx).toBeGreaterThanOrEqual(0);
    expect(widgetIdx).toBeGreaterThan(Math.max(cardIdx, mediaIdx));
    expect(frame).toContain('⚠');
    // Cycle rows are flat — no group glyphs on Card or Media rows.
    const cardLine = frame.split('\n').find((l) => l.includes('Card')) ?? '';
    expect(cardLine).not.toContain('▸');
    expect(cardLine).not.toContain('▾');
  });

  it('empty components render in empty tier with (empty) suffix', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Empty', { properties: [] })],
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Empty');
    expect(frame).toContain('(empty)');
  });

  it('tier order is: cycles → empty → grouped roots → standalones', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('Standalone'),
        item('Root', { slots: { s: ['Dep'] } }),
        item('Dep'),
        item('EmptyOne', { properties: [] }),
        item('CycleA', { slots: { s: ['CycleB'] } }),
        item('CycleB', { slots: { s: ['CycleA'] } }),
      ],
      cycleParticipants: new Set(['CycleA', 'CycleB']),
    });
    const frame = lastFrame() ?? '';
    const cycleIdx = frame.indexOf('CycleA');
    const emptyIdx = frame.indexOf('EmptyOne');
    const rootIdx = frame.indexOf('Root');
    const standaloneIdx = frame.indexOf('Standalone');
    expect(cycleIdx).toBeGreaterThanOrEqual(0);
    expect(emptyIdx).toBeGreaterThan(cycleIdx);
    expect(rootIdx).toBeGreaterThan(emptyIdx);
    expect(standaloneIdx).toBeGreaterThan(rootIdx);
  });

  it('shared dep renders under each root with a (shared) marker on 2nd+ occurrence', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('R1', { slots: { s: ['S'] } }),
        item('R2', { slots: { s: ['S'] } }),
        item('S'),
      ],
      expandedGroups: new Set(['R1', 'R2']),
    });
    const frame = lastFrame() ?? '';
    // S appears under both roots.
    const lines = frame.split('\n');
    const sLines = lines.filter((l) => /\bS\b/.test(l));
    expect(sLines.length).toBe(2);
    // At least one carries a "(shared)" marker on later occurrence.
    expect(frame).toContain('(shared)');
  });

  it('aggregate status: collapsed row shows ✗ when a dep is in error state', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('R1', { slots: { s: ['Bad'] } }),
        item('Bad', { status: 'error' }),
      ],
    });
    const frame = lastFrame() ?? '';
    const r1Line = frame.split('\n').find((l) => l.includes('R1')) ?? '';
    expect(r1Line).toContain('✗');
  });

  it('aggregate status: worst-case is ⚠ when only warnings present', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('R1', { slots: { s: ['Warn'] } }),
        item('Warn', { status: 'warning' }),
      ],
    });
    const frame = lastFrame() ?? '';
    const r1Line = frame.split('\n').find((l) => l.includes('R1')) ?? '';
    expect(r1Line).toContain('⚠');
    expect(r1Line).not.toContain('✗');
  });
});
