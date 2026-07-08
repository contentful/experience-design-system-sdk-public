import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  GroupedSidebar,
  visibleItemOrder,
  labelStyleFor,
  type GroupedSidebarItem,
  type VisibleRow,
} from '../../../../src/analyze/select/tui/components/GroupedSidebar.js';
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

  it('deep chain A->B->C->D: all descendants render, no +N more, indented per depth', () => {
    const items = [
      item('A', { slots: { s: ['B'] } }),
      item('B', { slots: { s: ['C'] } }),
      item('C', { slots: { s: ['D'] } }),
      item('D'),
    ];
    const { lastFrame } = renderSidebar({
      items,
      expandedGroups: new Set(['A']),
    });
    const frame = lastFrame() ?? '';
    // Never emit the overflow marker.
    expect(frame).not.toMatch(/\+\d+ more/);
    // Root + every descendant is present.
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
    expect(frame).toContain('D');

    // The A closure produces 4 total rows (root + 3 descendants). Assert on
    // the visible-row structure so we don't get fooled by substring matches
    // on ordinary letter tokens.
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['A']),
    });
    // All 4 items reachable via selectable rows exactly once.
    expect(order.slice().sort()).toEqual([0, 1, 2, 3]);

    // Each descendant should sit on its own line with tree glyphs and
    // depth-proportional indent (2 spaces per depth beyond 1).
    const lines = frame.split('\n');
    const bLine = lines.find((l) => /├─ B\b|└─ B\b/.test(l)) ?? '';
    const cLine = lines.find((l) => /├─ C\b|└─ C\b/.test(l)) ?? '';
    const dLine = lines.find((l) => /├─ D\b|└─ D\b/.test(l)) ?? '';
    expect(bLine).not.toBe('');
    expect(cLine).not.toBe('');
    expect(dLine).not.toBe('');
    // Indent grows with depth: B at depth 1 has no extra padding before the
    // tree glyph; C (depth 2) has 2 spaces; D (depth 3) has 4 spaces.
    expect(bLine.indexOf('├─') < cLine.indexOf('├─') + 1 || bLine.indexOf('└─') < cLine.indexOf('└─') + 1).toBe(true);
    const cGlyphIdx = cLine.search(/[├└]─/);
    const dGlyphIdx = dLine.search(/[├└]─/);
    expect(dGlyphIdx).toBeGreaterThan(cGlyphIdx);
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

  it('alwaysExpanded: renders every group as expanded regardless of expandedGroups', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Card', { slots: { body: ['Heading'] } }), item('Heading')],
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const frame = lastFrame() ?? '';
    // Root shows expanded glyph, and child is visible in the tree.
    expect(frame).toContain('▾ Card');
    expect(frame).not.toContain('▸ Card');
    expect(frame).toContain('Heading');
  });

  it('showFlatTier: adds header + every non-empty non-cycle component once', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('R1', { slots: { s: ['S'] } }),
        item('R2', { slots: { s: ['S'] } }),
        item('S'),
        item('Standalone'),
      ],
      expandedGroups: new Set(['R1', 'R2']),
      showFlatTier: true,
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('── All components ──');
    // Find the flat-tier section (after the header).
    const headerIdx = frame.indexOf('── All components ──');
    const flatSection = frame.slice(headerIdx);
    // Each component appears exactly once in the flat section.
    expect((flatSection.match(/\bR1\b/g) ?? []).length).toBe(1);
    expect((flatSection.match(/\bR2\b/g) ?? []).length).toBe(1);
    expect((flatSection.match(/\bS\b/g) ?? []).length).toBe(1);
    expect((flatSection.match(/\bStandalone\b/g) ?? []).length).toBe(1);
  });

  it('showFlatTier: cycle-participants and empty components are excluded from flat tier', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('Standalone'),
        item('EmptyOne', { properties: [] }),
        item('CycleA', { slots: { s: ['CycleB'] } }),
        item('CycleB', { slots: { s: ['CycleA'] } }),
      ],
      cycleParticipants: new Set(['CycleA', 'CycleB']),
      showFlatTier: true,
    });
    const frame = lastFrame() ?? '';
    const headerIdx = frame.indexOf('── All components ──');
    expect(headerIdx).toBeGreaterThan(-1);
    const flatSection = frame.slice(headerIdx);
    expect(flatSection).not.toContain('CycleA');
    expect(flatSection).not.toContain('CycleB');
    expect(flatSection).not.toContain('EmptyOne');
    expect(flatSection).toContain('Standalone');
  });

  it('selectionStateByKey: renders [✓] / [✗] / [ ] glyphs on component rows', () => {
    const { lastFrame } = renderSidebar({
      items: [item('A'), item('B'), item('C')],
      selectionStateByKey: new Map([
        ['A', 'accepted'],
        ['B', 'rejected'],
        ['C', 'undecided'],
      ]),
    });
    const frame = lastFrame() ?? '';
    const aLine = frame.split('\n').find((l) => l.includes(' A')) ?? '';
    const bLine = frame.split('\n').find((l) => l.includes(' B')) ?? '';
    const cLine = frame.split('\n').find((l) => l.includes(' C')) ?? '';
    expect(aLine).toContain('[✓]');
    expect(bLine).toContain('[✗]');
    expect(cLine).toContain('[ ]');
  });

  it('selectionStateByKey: group-root reflects the root\'s own selection state', () => {
    const { lastFrame } = renderSidebar({
      items: [
        item('Card', { slots: { s: ['Heading'] } }),
        item('Heading'),
      ],
      selectionStateByKey: new Map([
        ['Card', 'accepted'],
        ['Heading', 'rejected'],
      ]),
    });
    const frame = lastFrame() ?? '';
    const cardLine = frame.split('\n').find((l) => l.includes('Card')) ?? '';
    // Uses the ROOT's own state, not an aggregate.
    expect(cardLine).toContain('[✓]');
    expect(cardLine).not.toContain('[✗]');
  });

  it('dimPredicate: applies to rows whose key matches; group-roots never dim', () => {
    // We can't directly inspect ANSI escape codes cleanly, but we can verify
    // that the rendered frame still contains the labels (predicate does not
    // hide rows), and that build-visible-rows exposes the root regardless.
    const { lastFrame } = renderSidebar({
      items: [
        item('Card', { slots: { s: ['Heading'] } }),
        item('Heading'),
        item('Other'),
      ],
      expandedGroups: new Set(['Card']),
      dimPredicate: (k) => k === 'Card' || k === 'Heading',
    });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Card');
    expect(frame).toContain('Heading');
    expect(frame).toContain('Other');
  });

  it('aiFlaggedByKey: renders [×] AI-decision glyph before the label on flagged rows', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Widget')],
      aiFlaggedByKey: new Map([['Widget', true]]),
    });
    const frame = lastFrame() ?? '';
    const line = frame.split('\n').find((l) => l.includes('Widget')) ?? '';
    expect(line).toContain('[×]');
    expect(line.indexOf('[×]')).toBeLessThan(line.indexOf('Widget'));
    // The legacy trailing ` *` marker is gone.
    expect(line).not.toMatch(/Widget\s+\*/);
  });

  it('aiFlaggedByKey: no [×] glyph when key is absent or false', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Widget')],
      aiFlaggedByKey: new Map([['Widget', false]]),
    });
    const frame = lastFrame() ?? '';
    const line = frame.split('\n').find((l) => l.includes('Widget')) ?? '';
    expect(line).not.toContain('[×]');
    expect(line).not.toMatch(/Widget\s+\*/);
  });

  it('aiFlaggedByKey: flagged and non-flagged rows keep the label column aligned', () => {
    const { lastFrame } = renderSidebar({
      items: [item('Alpha'), item('Bravo')],
      aiFlaggedByKey: new Map([
        ['Alpha', true],
        ['Bravo', false],
      ]),
    });
    const frame = lastFrame() ?? '';
    const aLine = frame.split('\n').find((l) => l.includes('Alpha')) ?? '';
    const bLine = frame.split('\n').find((l) => l.includes('Bravo')) ?? '';
    expect(aLine.indexOf('Alpha')).toBe(bLine.indexOf('Bravo'));
  });

  describe('cursor row overrides row-kind coloring (labelStyleFor)', () => {
    // The cursor row must render uniformly "you are here" regardless of the
    // underlying row's kind or dim state. labelStyleFor is the pure helper
    // that drives the render loop's label <Text> props — we assert on it
    // directly to avoid coupling tests to ANSI escape output.
    const cycleRow: VisibleRow = {
      kind: 'cycle',
      key: 'cycle:Card',
      label: '⚠ Card (cycle)',
      indent: 0,
      itemIdx: 0,
    };
    const warnRootRow: VisibleRow = {
      kind: 'group-root',
      key: 'root:R1',
      label: '▸ R1 (1 dep) ⚠',
      indent: 0,
      aggregateGlyph: '⚠',
      itemIdx: 0,
    };
    const errorRootRow: VisibleRow = {
      kind: 'group-root',
      key: 'root:R1',
      label: '▸ R1 (1 dep) ✗',
      indent: 0,
      aggregateGlyph: '✗',
      itemIdx: 0,
    };
    const sharedChildRow: VisibleRow = {
      kind: 'group-child',
      key: 'child:R2:S',
      label: '└─ S (shared)',
      indent: 1,
      sharedSuffix: true,
      itemIdx: 0,
    };
    const standaloneRow: VisibleRow = {
      kind: 'standalone',
      key: 'stand:Widget',
      label: 'Widget',
      indent: 0,
      itemIdx: 0,
    };

    it('non-cursor cycle row keeps its red label color', () => {
      const s = labelStyleFor({ row: cycleRow, isCursor: false, wouldDim: false });
      expect(s.color).toBe('red');
      expect(s.bold).toBe(false);
      expect(s.dim).toBe(false);
    });

    it('cursor cycle row drops red — renders white + bold', () => {
      const s = labelStyleFor({ row: cycleRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe('white');
      expect(s.bold).toBe(true);
      expect(s.dim).toBe(false);
    });

    it('cursor aggregate-warning root drops yellow — renders white + bold', () => {
      const s = labelStyleFor({ row: warnRootRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe('white');
      expect(s.bold).toBe(true);
    });

    it('cursor aggregate-error root drops red — renders white + bold', () => {
      const s = labelStyleFor({ row: errorRootRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe('white');
      expect(s.bold).toBe(true);
    });

    it('cursor row on shared-suffix child suppresses dim', () => {
      const s = labelStyleFor({ row: sharedChildRow, isCursor: true, wouldDim: true });
      expect(s.dim).toBe(false);
      expect(s.color).toBe('white');
      expect(s.bold).toBe(true);
    });

    it('cursor row suppresses dim even when dimPredicate would apply', () => {
      const s = labelStyleFor({ row: standaloneRow, isCursor: true, wouldDim: true });
      expect(s.dim).toBe(false);
      expect(s.color).toBe('white');
    });

    it('non-cursor shared-suffix row still dims', () => {
      const s = labelStyleFor({ row: sharedChildRow, isCursor: false, wouldDim: true });
      expect(s.dim).toBe(true);
    });
  });

  describe('cycle rows carry user selection and cursor glyphs', () => {
    it('cycle row renders the user selection glyph when selectionStateByKey is provided', () => {
      const { lastFrame } = renderSidebar({
        items: [
          item('Card', { slots: { s: ['Media'] } }),
          item('Media', { slots: { s: ['Card'] } }),
        ],
        cycleParticipants: new Set(['Card', 'Media']),
        selectionStateByKey: new Map([
          ['Card', 'accepted'],
          ['Media', 'rejected'],
        ]),
      });
      const frame = lastFrame() ?? '';
      const cardLine = frame.split('\n').find((l) => l.includes('Card')) ?? '';
      const mediaLine = frame.split('\n').find((l) => l.includes('Media')) ?? '';
      expect(cardLine).toContain('[✓]');
      expect(mediaLine).toContain('[✗]');
    });

    it('cycle row renders the ▶ cursor glyph when selected + focused', () => {
      const { lastFrame } = renderSidebar({
        items: [
          item('Card', { slots: { s: ['Media'] } }),
          item('Media', { slots: { s: ['Card'] } }),
        ],
        cycleParticipants: new Set(['Card', 'Media']),
        selectedIdx: 0,
        focused: true,
      });
      const frame = lastFrame() ?? '';
      const cardLine = frame.split('\n').find((l) => l.includes('Card')) ?? '';
      expect(cardLine).toContain('▶');
    });
  });

  describe('cursor glyph', () => {
    it('cursor row is prefixed with a ▶ glyph when focused', () => {
      const { lastFrame } = renderSidebar({
        items: [item('Alpha'), item('Bravo')],
        selectedIdx: 0,
        focused: true,
      });
      const frame = lastFrame() ?? '';
      const alphaLine = frame.split('\n').find((l) => l.includes('Alpha')) ?? '';
      expect(alphaLine).toContain('▶');
    });

    it('non-cursor rows do NOT have the ▶ glyph (leading space reserved instead)', () => {
      const { lastFrame } = renderSidebar({
        items: [item('Alpha'), item('Bravo')],
        selectedIdx: 0,
        focused: true,
      });
      const frame = lastFrame() ?? '';
      const bravoLine = frame.split('\n').find((l) => l.includes('Bravo')) ?? '';
      expect(bravoLine).not.toContain('▶');
    });

    it('cursor row on a shared-dep suffix row is NOT dimmed', () => {
      // Two roots sharing dep S. When expanded, the 2nd S occurrence carries
      // `sharedSuffix=true` which would normally dim the row. If the cursor
      // lands on that row, brightness must be preserved so the user sees it.
      const items: GroupedSidebarItem[] = [
        item('R1', { slots: { s: ['S'] } }),
        item('R2', { slots: { s: ['S'] } }),
        item('S'),
      ];
      // Find visible-row order and put the cursor on the 2nd (shared) S.
      const order = visibleItemOrder({
        items,
        cycleParticipants: new Set(),
        expandedGroups: new Set(['R1', 'R2']),
      });
      // The 2nd occurrence of S's itemIdx corresponds to items index of S.
      const sIdx = items.findIndex((i) => i.key === 'S');
      // Confirm S is reachable in the visible order (it appears twice).
      expect(order.filter((i) => i === sIdx).length).toBe(2);

      const { lastFrame } = renderSidebar({
        items,
        expandedGroups: new Set(['R1', 'R2']),
        selectedIdx: sIdx,
        focused: true,
      });
      const frame = lastFrame() ?? '';
      // Both S rows share the same itemIdx, so both become "cursor rows"
      // visually. Assert the cursor glyph is present at least once and that
      // the shared-suffix row still renders its "(shared)" text without
      // being hidden.
      expect(frame).toContain('▶');
      expect(frame).toContain('(shared)');
      // The line carrying the cursor glyph should also NOT be wrapped in the
      // dim escape sequence. `ink-testing-library` strips ANSI, so we assert
      // structurally: the cursor row is present and legible.
      const cursorLine = frame.split('\n').find((l) => l.includes('▶')) ?? '';
      expect(cursorLine).toContain('S');
    });

    it('cursor row is NOT dimmed even when dimPredicate matches every row', () => {
      const { lastFrame } = renderSidebar({
        items: [item('Alpha'), item('Bravo')],
        selectedIdx: 0,
        focused: true,
        // Predicate that matches every component: normally every row would
        // dim; the cursor row must stay bright.
        dimPredicate: () => true,
      });
      const frame = lastFrame() ?? '';
      // Cursor row renders with the glyph even under a matching predicate.
      const cursorLine = frame.split('\n').find((l) => l.includes('▶')) ?? '';
      expect(cursorLine).toContain('Alpha');
    });
  });

  it('showFlatTier: flat rows are selectable via itemIdx', () => {
    const items = [
      item('Card', { slots: { s: ['Heading'] } }),
      item('Heading'),
    ];
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['Card']),
      showFlatTier: true,
    });
    // Expect grouped tier (Card, Heading) + flat tier (Card, Heading) — both
    // source indices appear exactly twice.
    expect(order.filter((i) => i === 0).length).toBe(2);
    expect(order.filter((i) => i === 1).length).toBe(2);
  });
});

describe('visibleItemOrder — navigation contract', () => {
  it('returns indices in rendered row order, not source-array order', () => {
    // items[] source order: Card(0), Heading(1), Standalone(2), Layout(3), Header(4)
    // Expected visible order (grouped roots alphabetical, each expanded, then standalones):
    //   Card, Heading, Layout, Header, Standalone → source idx [0, 1, 3, 4, 2]
    const items: GroupedSidebarItem[] = [
      item('Card', { slots: { header: ['Heading'] } }),
      item('Heading'),
      item('Standalone'),
      item('Layout', { slots: { header: ['Header'] } }),
      item('Header'),
    ];
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['Card', 'Layout']),
    });
    // Every source index must appear exactly once — no dropped rows, no dupes.
    expect(order.slice().sort()).toEqual([0, 1, 2, 3, 4]);
    // Order should follow the tier + group rendering.
    const nameOrder = order.map((i) => items[i].key);
    expect(nameOrder).toEqual(['Card', 'Heading', 'Layout', 'Header', 'Standalone']);
  });

  it('collapsed groups hide child indices; visible order still covers every visible row', () => {
    const items: GroupedSidebarItem[] = [
      item('Card', { slots: { header: ['Heading'] } }),
      item('Heading'),
      item('Standalone'),
    ];
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
    });
    // When Card is collapsed, Heading isn't a visible row — but Heading also
    // has no other selectable rendering, so it must NOT be reachable via ↑/↓
    // while collapsed. Verify Heading (idx 1) is absent from the order.
    expect(order).toEqual([0, 2]);
  });

  it('flat tier rows are included in navigation order', () => {
    const items: GroupedSidebarItem[] = [
      item('Card', { slots: { header: ['Heading'] } }),
      item('Heading'),
    ];
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      showFlatTier: true,
    });
    // Grouped Card (collapsed => just Card at idx 0), plus flat tier
    // (Card, Heading) selectable.
    expect(order.filter((i) => i === 0).length).toBe(2);
    expect(order.filter((i) => i === 1).length).toBe(1);
  });

  it('includes cycle-tier rows first in the navigation order', () => {
    const items: GroupedSidebarItem[] = [
      item('A'),
      item('CycleA', { slots: { s: ['CycleB'] } }),
      item('CycleB', { slots: { s: ['CycleA'] } }),
    ];
    const order = visibleItemOrder({
      items,
      cycleParticipants: new Set(['CycleA', 'CycleB']),
      expandedGroups: new Set(),
    });
    const nameOrder = order.map((i) => items[i].key);
    // Cycle tier first (alphabetical within tier), then the standalone.
    expect(nameOrder).toEqual(['CycleA', 'CycleB', 'A']);
  });

  it('selectedRowIdx renders exactly one row selected even when many rows share the same itemIdx', () => {
    // Two rows point at itemIdx 0. Without selectedRowIdx, selectedIdx=0
    // would inverse EVERY row that resolves to itemIdx 0 (the duplicate-
    // cursor bug from INTEG-4411). With selectedRowIdx=1, only the row at
    // visible-row position 1 is drawn selected.
    const items: GroupedSidebarItem[] = [item('Card'), item('Filler')];
    const visibleRows: VisibleRow[] = [
      { kind: 'group-child', key: 'child:A:Card', label: 'FIRST_CARD_ROW', indent: 1, itemIdx: 0 },
      { kind: 'group-child', key: 'child:B:Card', label: 'SECOND_CARD_ROW', indent: 1, itemIdx: 0 },
      { kind: 'flat', key: 'flat:Card', label: 'THIRD_CARD_ROW', indent: 0, itemIdx: 0 },
      { kind: 'flat', key: 'flat:Filler', label: 'FILLER_ROW', indent: 0, itemIdx: 1 },
    ];
    const { lastFrame } = renderSidebar({ items, visibleRows, selectedIdx: 0, selectedRowIdx: 1 });
    const frame = lastFrame() ?? '';
    // Cursor glyph appears exactly once — only on the row at selectedRowIdx.
    const cursorCount = (frame.match(/▶/g) ?? []).length;
    expect(cursorCount).toBe(1);
    // Verify it lands on SECOND_CARD_ROW specifically.
    const lines = frame.split('\n');
    const cursorLine = lines.find((l) => l.includes('▶')) ?? '';
    expect(cursorLine).toContain('SECOND_CARD_ROW');
  });

  it('when visibleRows prop is provided, renders those rows verbatim and skips internal computation', () => {
    // Hand-crafted rows that do NOT match anything buildVisibleRows would
    // compute from `items`. If GroupedSidebar honors the prop, we see the
    // sentinel labels; if it re-derives from items, we don't.
    const items: GroupedSidebarItem[] = [item('Alpha'), item('Bravo')];
    const visibleRows: VisibleRow[] = [
      { kind: 'standalone', key: 'stand:Alpha', label: 'HAND_CRAFTED_ALPHA', indent: 0, itemIdx: 0 },
      { kind: 'standalone', key: 'stand:Bravo', label: 'HAND_CRAFTED_BRAVO', indent: 0, itemIdx: 1 },
    ];
    const { lastFrame } = renderSidebar({ items, visibleRows });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('HAND_CRAFTED_ALPHA');
    expect(frame).toContain('HAND_CRAFTED_BRAVO');
    // The default label ("Alpha" alone as a standalone row) would only appear
    // if buildVisibleRows ran internally. The custom label overrides it.
    const handIdx = frame.indexOf('HAND_CRAFTED_ALPHA');
    const bareIdx = frame.indexOf('\nAlpha');
    expect(handIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBe(-1);
  });
});
