import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  GroupedSidebar,
  visibleItemOrder,
  labelStyleFor,
  selectionGlyphStyleFor,
  inheritanceGlyphStyleFor,
  buildVisibleRows,
  type GroupedSidebarItem,
  type VisibleRow,
} from '../../../../src/analyze/select/tui/components/GroupedSidebar.js';
import { PALETTE } from '../../../../src/analyze/select/tui/theme.js';
import type { NodeStatus } from '../../../../src/analyze/composite-closure.js';
import { buildComponentGraph } from '../../../../src/analyze/slot-graph.js';

const graphOf = (
  items: GroupedSidebarItem[],
  opts?: { stripRejectedEdges?: boolean },
) => buildComponentGraph(items, { stripRejectedEdges: opts?.stripRejectedEdges ?? true });

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
  const items = overrides.items ?? [];
  const defaults: React.ComponentProps<typeof GroupedSidebar> = {
    items,
    graph: graphOf(items),
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
    expect(frame).not.toMatch(/\+\d+ more/);
    expect(frame).toContain('A');
    expect(frame).toContain('B');
    expect(frame).toContain('C');
    expect(frame).toContain('D');

    const order = visibleItemOrder({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(['A']),
    });
    expect(order.slice().sort()).toEqual([0, 1, 2, 3]);

    const lines = frame.split('\n');
    const bLine = lines.find((l) => /├─ B\b|└─ B\b/.test(l)) ?? '';
    const cLine = lines.find((l) => /├─ C\b|└─ C\b/.test(l)) ?? '';
    const dLine = lines.find((l) => /├─ D\b|└─ D\b/.test(l)) ?? '';
    expect(bLine).not.toBe('');
    expect(cLine).not.toBe('');
    expect(dLine).not.toBe('');
    expect(bLine.indexOf('├─') < cLine.indexOf('├─') + 1 || bLine.indexOf('└─') < cLine.indexOf('└─') + 1).toBe(true);
    const cGlyphIdx = cLine.search(/[├└]─/);
    const dGlyphIdx = dLine.search(/[├└]─/);
    expect(dGlyphIdx).toBeGreaterThan(cGlyphIdx);
  });

  it('cycle participants render at TOP with ⚠ and an expand glyph', () => {
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
    const cardLine = frame.split('\n').find((l) => l.includes('Card')) ?? '';
    expect(cardLine).toContain('▸');
    expect(cardLine).toContain('⚠');
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
    const lines = frame.split('\n');
    const sLines = lines.filter((l) => /\bS\b/.test(l));
    expect(sLines.length).toBe(2);
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
    const headerIdx = frame.indexOf('── All components ──');
    const flatSection = frame.slice(headerIdx);
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
    expect(cardLine).toContain('[✓]');
    expect(cardLine).not.toContain('[✗]');
  });

  it('dimPredicate: applies to rows whose key matches; group-roots never dim', () => {
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

    it('non-cursor cycle row keeps its error label color', () => {
      const s = labelStyleFor({ row: cycleRow, isCursor: false, wouldDim: false });
      expect(s.color).toBe(PALETTE.error);
      expect(s.bold).toBe(false);
      expect(s.dim).toBe(false);
    });

    it('cursor cycle row drops error — renders cursor-accent + bold', () => {
      const s = labelStyleFor({ row: cycleRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe(PALETTE.info);
      expect(s.bold).toBe(true);
      expect(s.dim).toBe(false);
    });

    it('cursor aggregate-warning root drops warning — renders cursor-accent + bold', () => {
      const s = labelStyleFor({ row: warnRootRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe(PALETTE.info);
      expect(s.bold).toBe(true);
    });

    it('cursor aggregate-error root drops error — renders cursor-accent + bold', () => {
      const s = labelStyleFor({ row: errorRootRow, isCursor: true, wouldDim: false });
      expect(s.color).toBe(PALETTE.info);
      expect(s.bold).toBe(true);
    });

    it('cursor row on shared-suffix child suppresses dim', () => {
      const s = labelStyleFor({ row: sharedChildRow, isCursor: true, wouldDim: true });
      expect(s.dim).toBe(false);
      expect(s.color).toBe(PALETTE.info);
      expect(s.bold).toBe(true);
    });

    it('cursor row suppresses dim even when dimPredicate would apply', () => {
      const s = labelStyleFor({ row: standaloneRow, isCursor: true, wouldDim: true });
      expect(s.dim).toBe(false);
      expect(s.color).toBe(PALETTE.info);
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
      const items: GroupedSidebarItem[] = [
        item('R1', { slots: { s: ['S'] } }),
        item('R2', { slots: { s: ['S'] } }),
        item('S'),
      ];
      const order = visibleItemOrder({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(),
        expandedGroups: new Set(['R1', 'R2']),
      });
      const sIdx = items.findIndex((i) => i.key === 'S');
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
      const cursorLine = frame.split('\n').find((l) => l.includes('▶')) ?? '';
      expect(cursorLine).toContain('S');
    });

    it('cursor row is NOT dimmed even when dimPredicate matches every row', () => {
      const { lastFrame } = renderSidebar({
        items: [item('Alpha'), item('Bravo')],
        selectedIdx: 0,
        focused: true,
        dimPredicate: () => true,
      });
      const frame = lastFrame() ?? '';
      const cursorLine = frame.split('\n').find((l) => l.includes('▶')) ?? '';
      expect(cursorLine).toContain('Alpha');
    });
  });

  describe('cycle-member injection under composite parents (INTEG cycle-child)', () => {
    it('renders a cycle member as ⚠ child under a composite that slots it', () => {
      const items = [
        item('InnerA', { slots: { s: ['InnerB'] } }),
        item('InnerB', { slots: { s: ['InnerA'] } }),
        item('SharedInterior', { slots: { s: ['InnerA'] } }),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['InnerA', 'InnerB']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows[0].label).toContain('InnerA');
      expect(cycleRows[1].label).toContain('InnerB');
      const rootRow = rows.find((r) => r.kind === 'group-root');
      expect(rootRow?.label).toContain('SharedInterior');
      const child = rows.find((r) => r.kind === 'group-child' && r.rootName === 'SharedInterior');
      expect(child).toBeDefined();
      expect(child!.label).toContain('⚠');
      expect(child!.label).toContain('InnerA');
      expect(child!.label).toContain('(cycle)');
      expect(child!.cycleChild).toBe(true);
      expect(child!.kind).toBe('group-child');
    });

    it('deep chain: cycle member appears under transitively-reachable ancestors', () => {
      const items = [
        item('InnerA', { slots: { s: ['InnerB'] } }),
        item('InnerB', { slots: { s: ['InnerA'] } }),
        item('SharedInterior', { slots: { s: ['InnerA'] } }),
        item('Wrapper1', { slots: { s: ['SharedInterior'] } }),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['InnerA', 'InnerB']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const wrapper1ChildRows = rows.filter(
        (r) => r.kind === 'group-child' && r.rootName === 'Wrapper1',
      );
      const sharedRow = wrapper1ChildRows.find((r) => r.label.includes('SharedInterior'));
      const innerARow = wrapper1ChildRows.find((r) => r.label.includes('InnerA'));
      expect(sharedRow).toBeDefined();
      expect(innerARow).toBeDefined();
      expect(innerARow!.cycleChild).toBe(true);
      expect(innerARow!.label).toContain('⚠');
      expect(innerARow!.indent).toBe(2);
    });

    it('cycle-member slotted by multiple composites gets (shared) on 2nd+ occurrence', () => {
      const items = [
        item('InnerA', { slots: { s: ['InnerB'] } }),
        item('InnerB', { slots: { s: ['InnerA'] } }),
        item('Wrapper1', { slots: { s: ['InnerA'] } }),
        item('Wrapper2', { slots: { s: ['InnerA'] } }),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['InnerA', 'InnerB']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const innerAChildRows = rows.filter(
        (r) =>
          r.kind === 'group-child' &&
          r.label.includes('InnerA') &&
          (r.rootName === 'Wrapper1' || r.rootName === 'Wrapper2'),
      );
      expect(innerAChildRows.length).toBe(2);
      expect(innerAChildRows[0].sharedSuffix).toBeFalsy();
      expect(innerAChildRows[1].sharedSuffix).toBe(true);
      expect(innerAChildRows[1].label).toContain('(shared)');
    });

    it('cycle-tier row expands into a mini hierarchy under alwaysExpanded (task 35)', () => {
      const items = [
        item('NodeA', { slots: { s: ['NodeB'] } }),
        item('NodeB', { slots: { s: ['NodeA'] } }),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['NodeA', 'NodeB']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows[0].label).toContain('▾');
      expect(cycleRows[0].label).toContain('⚠');
      expect(cycleRows[1].label).toContain('▾');
      const nodeAChildren = rows.filter(
        (r) => r.kind === 'group-child' && r.rootName === 'NodeA',
      );
      const nodeBChildren = rows.filter(
        (r) => r.kind === 'group-child' && r.rootName === 'NodeB',
      );
      expect(nodeAChildren.length).toBeGreaterThan(0);
      expect(nodeBChildren.length).toBeGreaterThan(0);
      expect(nodeAChildren[0].label).toContain('NodeB');
      expect(nodeAChildren[0].label).toContain('(cycle)');
      expect(nodeAChildren[0].cycleChild).toBe(true);
    });

    it('cycle-tier expansion surfaces composite cycle-member slot targets (task 35)', () => {
      const items = [
        item('Panel', { slots: { s: ['Section', 'Heading'] } }),
        item('Section', { slots: { s: ['Panel', 'Text'] } }),
        item('Heading'),
        item('Text'),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['Panel', 'Section']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const panelChildren = rows.filter(
        (r) => r.kind === 'group-child' && r.rootName === 'Panel',
      );
      const names = panelChildren.map((r) => {
        return r.label;
      });
      expect(panelChildren.some((r) => r.label.includes('Section') && r.cycleChild === true)).toBe(true);
      expect(panelChildren.some((r) => r.label.includes('Heading'))).toBe(true);
      expect(panelChildren.some((r) => r.label.includes('Text'))).toBe(true);
      const headingRow = panelChildren.find((r) => r.label.includes('Heading'));
      expect(headingRow?.cycleChild).toBeFalsy();
      expect(names.length).toBeGreaterThanOrEqual(3);
    });

    it('cycle-tier rows are collapsed by default when alwaysExpanded is false', () => {
      const items = [
        item('NodeA', { slots: { s: ['NodeB'] } }),
        item('NodeB', { slots: { s: ['NodeA'] } }),
      ];
      const collapsedRows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['NodeA', 'NodeB']),
        expandedGroups: new Set(),
      });
      const cycleRows = collapsedRows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.every((r) => r.label.includes('▸'))).toBe(true);
      expect(collapsedRows.filter((r) => r.kind === 'group-child').length).toBe(0);

      const partiallyExpanded = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['NodeA', 'NodeB']),
        expandedGroups: new Set(['NodeA']),
      });
      const nodeARow = partiallyExpanded.find((r) => r.kind === 'cycle' && r.rootName === 'NodeA');
      const nodeBRow = partiallyExpanded.find((r) => r.kind === 'cycle' && r.rootName === 'NodeB');
      expect(nodeARow?.label).toContain('▾');
      expect(nodeBRow?.label).toContain('▸');
      const nodeAChildren = partiallyExpanded.filter(
        (r) => r.kind === 'group-child' && r.rootName === 'NodeA',
      );
      expect(nodeAChildren.length).toBeGreaterThan(0);
    });

    it('cycle-participant is never promoted to a group-root', () => {
      const items = [
        item('InnerA', { slots: { s: ['InnerB'] } }),
        item('InnerB', { slots: { s: ['InnerA'] } }),
      ];
      const rows = buildVisibleRows({
        items,
        graph: graphOf(items),
        cycleParticipants: new Set(['InnerA', 'InnerB']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      expect(rows.every((r) => r.kind !== 'group-root')).toBe(true);
      expect(rows.every((r) => r.kind !== 'standalone')).toBe(true);
    });
  });

  it('showFlatTier: flat rows are selectable via itemIdx', () => {
    const items = [
      item('Card', { slots: { s: ['Heading'] } }),
      item('Heading'),
    ];
    const order = visibleItemOrder({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(['Card']),
      showFlatTier: true,
    });
    expect(order.filter((i) => i === 0).length).toBe(2);
    expect(order.filter((i) => i === 1).length).toBe(2);
  });
});

describe('visibleItemOrder — navigation contract', () => {
  it('returns indices in rendered row order, not source-array order', () => {
    const items: GroupedSidebarItem[] = [
      item('Card', { slots: { header: ['Heading'] } }),
      item('Heading'),
      item('Standalone'),
      item('Layout', { slots: { header: ['Header'] } }),
      item('Header'),
    ];
    const order = visibleItemOrder({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(['Card', 'Layout']),
    });
    expect(order.slice().sort()).toEqual([0, 1, 2, 3, 4]);
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
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
    });
    expect(order).toEqual([0, 2]);
  });

  it('flat tier rows are included in navigation order', () => {
    const items: GroupedSidebarItem[] = [
      item('Card', { slots: { header: ['Heading'] } }),
      item('Heading'),
    ];
    const order = visibleItemOrder({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      showFlatTier: true,
    });
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
      graph: graphOf(items),
      cycleParticipants: new Set(['CycleA', 'CycleB']),
      expandedGroups: new Set(),
    });
    const nameOrder = order.map((i) => items[i].key);
    expect(nameOrder).toEqual(['CycleA', 'CycleB', 'A']);
  });

  it('selectedRowIdx renders exactly one row selected even when many rows share the same itemIdx', () => {
    const items: GroupedSidebarItem[] = [item('Card'), item('Filler')];
    const visibleRows: VisibleRow[] = [
      { kind: 'group-child', key: 'child:A:Card', label: 'FIRST_CARD_ROW', indent: 1, itemIdx: 0 },
      { kind: 'group-child', key: 'child:B:Card', label: 'SECOND_CARD_ROW', indent: 1, itemIdx: 0 },
      { kind: 'flat', key: 'flat:Card', label: 'THIRD_CARD_ROW', indent: 0, itemIdx: 0 },
      { kind: 'flat', key: 'flat:Filler', label: 'FILLER_ROW', indent: 0, itemIdx: 1 },
    ];
    const { lastFrame } = renderSidebar({ items, visibleRows, selectedIdx: 0, selectedRowIdx: 1 });
    const frame = lastFrame() ?? '';
    const cursorCount = (frame.match(/▶/g) ?? []).length;
    expect(cursorCount).toBe(1);
    const lines = frame.split('\n');
    const cursorLine = lines.find((l) => l.includes('▶')) ?? '';
    expect(cursorLine).toContain('SECOND_CARD_ROW');
  });

  it('when visibleRows prop is provided, renders those rows verbatim and skips internal computation', () => {
    const items: GroupedSidebarItem[] = [item('Alpha'), item('Bravo')];
    const visibleRows: VisibleRow[] = [
      { kind: 'standalone', key: 'stand:Alpha', label: 'HAND_CRAFTED_ALPHA', indent: 0, itemIdx: 0 },
      { kind: 'standalone', key: 'stand:Bravo', label: 'HAND_CRAFTED_BRAVO', indent: 0, itemIdx: 1 },
    ];
    const { lastFrame } = renderSidebar({ items, visibleRows });
    const frame = lastFrame() ?? '';
    expect(frame).toContain('HAND_CRAFTED_ALPHA');
    expect(frame).toContain('HAND_CRAFTED_BRAVO');
    const handIdx = frame.indexOf('HAND_CRAFTED_ALPHA');
    const bareIdx = frame.indexOf('\nAlpha');
    expect(handIdx).toBeGreaterThanOrEqual(0);
    expect(bareIdx).toBe(-1);
  });
});

describe('buildVisibleRows — flat view mode', () => {
  it('emits one flat row per component, alphabetical, no group nesting', () => {
    const items = [
      item('Card', { slots: { body: ['Text'] } }),
      item('Text'),
      item('Standalone'),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      viewMode: 'flat',
    });
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has('group-root')).toBe(false);
    expect(kinds.has('group-child')).toBe(false);
    expect(kinds.has('standalone')).toBe(false);
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.label)).toEqual([
      'Card (1 dep)',
      'Standalone',
      'Text',
    ]);
  });

  it('pins cycle participants to the top (alphabetical), then flat rows', () => {
    const items = [
      item('Zeta'),
      item('Alpha'),
      item('Loopy', { slots: { child: ['Inner'] } }),
      item('Inner', { slots: { back: ['Loopy'] } }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(['Loopy', 'Inner']),
      expandedGroups: new Set(),
      viewMode: 'flat',
    });
    expect(rows[0].kind).toBe('cycle');
    expect(rows[0].label).toContain('Inner');
    expect(rows[1].kind).toBe('cycle');
    expect(rows[1].label).toContain('Loopy');
    expect(rows.slice(2).map((r) => r.label)).toEqual(['Alpha', 'Zeta']);
  });

  it('renders each component exactly once — no shared-dep duplication', () => {
    const items = [
      item('Card', { slots: { body: ['Text'] } }),
      item('Panel', { slots: { title: ['Text'] } }),
      item('Text'),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      viewMode: 'flat',
    });
    const textRows = rows.filter((r) => r.label.startsWith('Text'));
    expect(textRows.length).toBe(1);
  });
});

describe('buildVisibleRows — cycle member no longer in a cycle', () => {
  it('renders both InnerA and InnerB when InnerA has removed its cycle-forming slot', () => {
    const items = [
      item('InnerA', { slots: { s: [] } }),
      item('InnerB', { slots: { s: ['InnerA'] } }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const labels = rows.map((r) => r.label);
    // Both must show up somewhere.
    expect(labels.some((l) => l.includes('InnerA'))).toBe(true);
    expect(labels.some((l) => l.includes('InnerB'))).toBe(true);
  });

  it('renders both InnerA and InnerB when cycleParticipants set is STALE (still lists them)', () => {
    const items = [
      item('InnerA', { slots: { s: [] } }),
      item('InnerB', { slots: { s: ['InnerA'] } }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(['InnerA', 'InnerB']),
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const labels = rows.map((r) => r.label);
    expect(labels.some((l) => l.includes('InnerA'))).toBe(true);
    expect(labels.some((l) => l.includes('InnerB'))).toBe(true);
  });
});

describe('buildVisibleRows — rejected ancestor must not bury its slot targets', () => {
  it('promotes InnerA to a top-level row when its only referrer InnerB is rejected', () => {
    const items = [
      item('InnerA', { slots: { s: [] }, status: 'error' }),
      item('InnerB', { slots: { s: ['InnerA'] }, status: 'error' }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const topLevel = rows.filter((r) => r.indent === 0);
    const topKeys = topLevel.map((r) => r.rootName ?? r.itemIdx).filter(Boolean);
    const innerARows = rows.filter(
      (r) =>
        (r.kind === 'standalone' || r.kind === 'group-root' || r.kind === 'flat') &&
        r.label.includes('InnerA'),
    );
    expect(innerARows.length).toBeGreaterThan(0);
    const innerBLabels = rows
      .filter((r) => r.label.includes('InnerB'))
      .map((r) => r.label);
    expect(innerBLabels.some((l) => l.includes('(cycle)'))).toBe(false);
  });

  it('a rejected composite with a live slot target still promotes the target to top-level', () => {
    const items = [
      item('Wrapper1', { slots: { body: ['SharedInterior'] }, status: 'error' }),
      item('SharedInterior', { status: 'ok' }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const sharedTopLevel = rows.filter(
      (r) =>
        (r.kind === 'standalone' || r.kind === 'group-root' || r.kind === 'flat') &&
        r.label.includes('SharedInterior'),
    );
    expect(sharedTopLevel.length).toBeGreaterThan(0);
  });

  it('a LIVE composite still groups its live slot target (no over-flattening)', () => {
    const items = [
      item('Card', { slots: { body: ['Text'] }, status: 'ok' }),
      item('Text', { status: 'ok' }),
    ];
    const rows = buildVisibleRows({
      items,
      graph: graphOf(items),
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      alwaysExpanded: true,
    });
    const cardRoot = rows.find(
      (r) => r.kind === 'group-root' && r.label.includes('Card'),
    );
    expect(cardRoot).toBeDefined();
    const textAsChild = rows.find(
      (r) => r.kind === 'group-child' && r.label.includes('Text'),
    );
    expect(textAsChild).toBeDefined();
    const textAsStandalone = rows.find(
      (r) => r.kind === 'standalone' && r.label.includes('Text'),
    );
    expect(textAsStandalone).toBeUndefined();
  });
});

describe('ADR-0010 scenarios — buildVisibleRows layer', () => {
  describe('Scenario A — P ↔ C cycle', () => {
    const scenarioA = (statusP: NodeStatus, statusC: NodeStatus): GroupedSidebarItem[] => [
      item('P', { slots: { s: ['C'] }, status: statusP }),
      item('C', { slots: { s: ['P'] }, status: statusC }),
    ];

    it('mount default (both ok, cycleParticipants={P,C}) — two cycle-tier rows, no group-root, cycle-child marker present', () => {
      const rows = buildVisibleRows({
        items: scenarioA('ok', 'ok'),
        graph: graphOf(scenarioA('ok', 'ok')),
        cycleParticipants: new Set(['P', 'C']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      // Alphabetical inside the cycle tier: C first, then P.
      expect(cycleRows[0].label).toContain('C');
      expect(cycleRows[0].label).toContain('⚠');
      expect(cycleRows[0].label).toContain('(cycle)');
      expect(cycleRows[1].label).toContain('P');
      expect(rows.every((r) => r.kind !== 'group-root')).toBe(true);
      expect(rows.every((r) => r.kind !== 'standalone')).toBe(true);
      const pChildren = rows.filter((r) => r.kind === 'group-child' && r.rootName === 'P');
      const cChildren = rows.filter((r) => r.kind === 'group-child' && r.rootName === 'C');
      expect(pChildren.some((r) => r.label.includes('C') && r.cycleChild === true)).toBe(true);
      expect(cChildren.some((r) => r.label.includes('P') && r.cycleChild === true)).toBe(true);
    });

    it('both rejected (GenerateReview post-auto-reject) still renders both cycle-tier rows with (cycle) markers', () => {
      const rows = buildVisibleRows({
        items: scenarioA('error', 'error'),
        graph: graphOf(scenarioA('error', 'error')),
        cycleParticipants: new Set(['P', 'C']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows.every((r) => r.label.includes('(cycle)'))).toBe(true);
    });

    it('collapsed cycle rows carry the ▸ glyph and emit no group-children', () => {
      const rows = buildVisibleRows({
        items: scenarioA('ok', 'ok'),
        graph: graphOf(scenarioA('ok', 'ok')),
        cycleParticipants: new Set(['P', 'C']),
        expandedGroups: new Set(),
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows.every((r) => r.label.includes('▸'))).toBe(true);
      expect(rows.filter((r) => r.kind === 'group-child').length).toBe(0);
    });
  });

  describe('Scenario B — P → C, C ↔ X (P not in cycle)', () => {
    const scenarioB = (
      statusP: NodeStatus,
      statusC: NodeStatus,
      statusX: NodeStatus,
    ): GroupedSidebarItem[] => [
      item('P', { slots: { s: ['C'] }, status: statusP }),
      item('C', { slots: { s: ['X'] }, status: statusC }),
      item('X', { slots: { s: ['C'] }, status: statusX }),
    ];

    it('ScopeGate mount (statuses ok, cycleParticipants={C,X}) — cycle tier has C+X; P is a group-root with cycle-child C in its subtree', () => {
      const rows = buildVisibleRows({
        items: scenarioB('ok', 'ok', 'ok'),
        graph: graphOf(scenarioB('ok', 'ok', 'ok')),
        cycleParticipants: new Set(['C', 'X']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows[0].label).toContain('C');
      expect(cycleRows[1].label).toContain('X');
      const pRoot = rows.find((r) => r.kind === 'group-root' && r.label.includes('P'));
      expect(pRoot).toBeDefined();
      const pChildren = rows.filter((r) => r.kind === 'group-child' && r.rootName === 'P');
      const cUnderP = pChildren.find((r) => r.label.includes('C'));
      expect(cUnderP).toBeDefined();
      expect(cUnderP!.cycleChild).toBe(true);
      expect(cUnderP!.label).toContain('(cycle)');
    });

    it('GenerateReview mount (all three rejected) — cycle-tier rows C+X shown independently', () => {
      const rows = buildVisibleRows({
        items: scenarioB('error', 'error', 'error'),
        graph: graphOf(scenarioB('error', 'error', 'error')),
        cycleParticipants: new Set(['C', 'X']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows.map((r) => r.rootName).sort()).toEqual(['C', 'X']);
      const pRows = rows.filter((r) => r.label.includes('P') && r.kind !== 'group-child');
      expect(pRows.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario C — P ↔ X cycle, P also slots C (C is a leaf, not in any cycle)', () => {
    const scenarioC = (
      statusP: NodeStatus,
      statusX: NodeStatus,
      statusC: NodeStatus,
    ): GroupedSidebarItem[] => [
      item('P', { slots: { s: ['X', 'C'] }, status: statusP }),
      item('X', { slots: { s: ['P'] }, status: statusX }),
      item('C', { status: statusC }),
    ];

    it('mount defaults (all ok, cycleParticipants={P,X}) — P+X in cycle tier; C is NOT decorated (cycle)', () => {
      const rows = buildVisibleRows({
        items: scenarioC('ok', 'ok', 'ok'),
        graph: graphOf(scenarioC('ok', 'ok', 'ok')),
        cycleParticipants: new Set(['P', 'X']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cycleRows = rows.filter((r) => r.kind === 'cycle');
      expect(cycleRows.length).toBe(2);
      expect(cycleRows.map((r) => r.rootName).sort()).toEqual(['P', 'X']);
      const cRows = rows.filter((r) => /(^|[^A-Za-z])C([^A-Za-z]|$)/.test(r.label));
      expect(cRows.length).toBeGreaterThan(0);
      for (const r of cRows) {
        expect(r.label).not.toContain('(cycle)');
        expect(r.cycleChild).toBeFalsy();
      }
    });

    it('P expanded — subtree emits X as cycle-child AND C as a plain group-child', () => {
      const rows = buildVisibleRows({
        items: scenarioC('ok', 'ok', 'ok'),
        graph: graphOf(scenarioC('ok', 'ok', 'ok')),
        cycleParticipants: new Set(['P', 'X']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const pChildren = rows.filter((r) => r.kind === 'group-child' && r.rootName === 'P');
      const xUnderP = pChildren.find((r) => r.label.includes('X'));
      expect(xUnderP).toBeDefined();
      expect(xUnderP!.cycleChild).toBe(true);
      const cUnderP = pChildren.find((r) => /(^|[^A-Za-z])C([^A-Za-z]|$)/.test(r.label));
      expect(cUnderP).toBeDefined();
      expect(cUnderP!.cycleChild).toBeFalsy();
      expect(cUnderP!.label).not.toContain('(cycle)');
    });

    it('GenerateReview mount (P and X rejected, C ok) — C promotes to a top-level row', () => {
      const rows = buildVisibleRows({
        items: scenarioC('error', 'error', 'ok'),
        graph: graphOf(scenarioC('error', 'error', 'ok')),
        cycleParticipants: new Set(['P', 'X']),
        expandedGroups: new Set(),
        alwaysExpanded: true,
      });
      const cTopLevel = rows.filter(
        (r) =>
          (r.kind === 'standalone' || r.kind === 'group-root' || r.kind === 'flat') &&
          /(^|[^A-Za-z])C([^A-Za-z]|$)/.test(r.label),
      );
      expect(cTopLevel.length).toBeGreaterThan(0);
      const anyCRow = rows.filter((r) => /(^|[^A-Za-z])C([^A-Za-z]|$)/.test(r.label));
      for (const r of anyCRow) {
        expect(r.label).not.toContain('(cycle)');
      }
    });
  });
});

describe('GroupedSidebar — filterVisibleKeys', () => {
  const chain = () => [
    item('A', { slots: { s: ['B'] } }),
    item('B', { slots: { s: ['C'] } }),
    item('C', { slots: { s: ['D'] } }),
    item('D'),
  ];

  it('grouped view: filter=[B, direct neighbors] shows A/B/C, hides D', () => {
    const items = chain();
    const filter = new Set(['A', 'B', 'C']);
    const rows = buildVisibleRows({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['A', 'B', 'C']),
      alwaysExpanded: true,
      viewMode: 'grouped',
      graph: graphOf(items),
      filterVisibleKeys: filter,
    });
    const keys = rows.filter((r) => r.itemIdx >= 0).map((r) => items[r.itemIdx].key);
    expect(keys).toContain('A');
    expect(keys).toContain('B');
    expect(keys).toContain('C');
    expect(keys).not.toContain('D');
  });

  it('direct-only, not transitive: filter of A+neighbors shows A/B, hides C/D', () => {
    const items = chain();
    const filter = new Set(['A', 'B']);
    const rows = buildVisibleRows({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['A', 'B', 'C']),
      alwaysExpanded: true,
      viewMode: 'grouped',
      graph: graphOf(items),
      filterVisibleKeys: filter,
    });
    const keys = rows.filter((r) => r.itemIdx >= 0).map((r) => items[r.itemIdx].key);
    expect(keys).toContain('A');
    expect(keys).toContain('B');
    expect(keys).not.toContain('C');
    expect(keys).not.toContain('D');
  });

  it('flat view ignores filterVisibleKeys — every component present', () => {
    const items = chain();
    const filter = new Set(['B']);
    const rows = buildVisibleRows({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(),
      alwaysExpanded: true,
      viewMode: 'flat',
      graph: graphOf(items),
      filterVisibleKeys: filter,
    });
    const keys = rows.filter((r) => r.itemIdx >= 0).map((r) => items[r.itemIdx].key);
    expect(keys).toContain('A');
    expect(keys).toContain('B');
    expect(keys).toContain('C');
    expect(keys).toContain('D');
  });

  it('undefined filter = no filtering (all rows visible)', () => {
    const items = chain();
    const rows = buildVisibleRows({
      items,
      cycleParticipants: new Set(),
      expandedGroups: new Set(['A', 'B', 'C']),
      alwaysExpanded: true,
      viewMode: 'grouped',
      graph: graphOf(items),
    });
    const keys = new Set(
      rows.filter((r) => r.itemIdx >= 0).map((r) => items[r.itemIdx].key),
    );
    expect(keys.has('A')).toBe(true);
    expect(keys.has('B')).toBe(true);
    expect(keys.has('C')).toBe(true);
    expect(keys.has('D')).toBe(true);
  });

  it('cycle-tier row respects filter — cycle members hidden unless in set', () => {
    // X ↔ Y form a cycle; Z is unrelated.
    const items = [
      item('X', { slots: { s: ['Y'] } }),
      item('Y', { slots: { s: ['X'] } }),
      item('Z'),
    ];
    const rows = buildVisibleRows({
      items,
      cycleParticipants: new Set(['X', 'Y']),
      expandedGroups: new Set(),
      alwaysExpanded: true,
      viewMode: 'grouped',
      graph: graphOf(items),
      filterVisibleKeys: new Set(['Z']),
    });
    const keys = rows.filter((r) => r.itemIdx >= 0).map((r) => items[r.itemIdx].key);
    expect(keys).toContain('Z');
    expect(keys).not.toContain('X');
    expect(keys).not.toContain('Y');
  });
});

describe('status glyphs are always semantic green/red, never white', () => {
  describe('selectionGlyphStyleFor', () => {
    it('accepted glyph is success-green on a non-cycle row', () => {
      const s = selectionGlyphStyleFor('accepted', false);
      expect(s.glyph).toBe('[✓]');
      expect(s.color).toBe(PALETTE.success);
    });

    it('accepted glyph stays success-green on a CYCLE row (never white)', () => {
      const s = selectionGlyphStyleFor('accepted', true);
      expect(s.glyph).toBe('[✓]');
      expect(s.color).toBe(PALETTE.success);
      expect(s.color).not.toBe('white');
      expect(s.color).not.toBe(PALETTE.inverse);
    });

    it('rejected glyph is error-red on a non-cycle row', () => {
      const s = selectionGlyphStyleFor('rejected', false);
      expect(s.glyph).toBe('[✗]');
      expect(s.color).toBe(PALETTE.error);
    });

    it('rejected glyph stays error-red on a CYCLE row (never white)', () => {
      const s = selectionGlyphStyleFor('rejected', true);
      expect(s.glyph).toBe('[✗]');
      expect(s.color).toBe(PALETTE.error);
      expect(s.color).not.toBe('white');
      expect(s.color).not.toBe(PALETTE.inverse);
    });

    it('undecided glyph carries no accept/reject color on any row kind', () => {
      const nonCycle = selectionGlyphStyleFor('undecided', false);
      const cycle = selectionGlyphStyleFor('undecided', true);
      expect(nonCycle.glyph).toBe('[ ]');
      expect(cycle.glyph).toBe('[ ]');
      expect(cycle.color).not.toBe('white');
      expect(cycle.color).not.toBe(PALETTE.inverse);
    });
  });

  describe('inheritanceGlyphStyleFor', () => {
    it('error glyph is error-red when the cursor is NOT on the row', () => {
      const s = inheritanceGlyphStyleFor({ status: 'error', isOwn: true, isCursor: false });
      expect(s.glyph).toBe('✗');
      expect(s.color).toBe(PALETTE.error);
    });

    it('error glyph stays error-red when the CURSOR is on the row (never white)', () => {
      const s = inheritanceGlyphStyleFor({ status: 'error', isOwn: true, isCursor: true });
      expect(s.glyph).toBe('✗');
      expect(s.color).toBe(PALETTE.error);
      expect(s.color).not.toBe('white');
      expect(s.color).not.toBe(PALETTE.inverse);
    });

    it('warning glyph stays warning-yellow when the CURSOR is on the row (never white)', () => {
      const s = inheritanceGlyphStyleFor({ status: 'warning', isOwn: true, isCursor: true });
      expect(s.glyph).toBe('⚠');
      expect(s.color).toBe(PALETTE.warning);
      expect(s.color).not.toBe('white');
      expect(s.color).not.toBe(PALETTE.inverse);
    });
  });
});

