import { describe, expect, it } from 'vitest';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import {
  buildDiffLines,
  buildSummaryLines,
  hasChanges,
  nextScrollOffset,
  previewAction,
  scrollIndicator,
  viewportHeight,
} from '../../../src/tui/import/steps/preview-gate/logic.js';

const NO_KEY = { return: false, escape: false, upArrow: false, downArrow: false };

function makePreview(overrides: Record<string, unknown> = {}): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    ...overrides,
  } as unknown as ServerPreviewResponse;
}

function changedComponent(name: string, extra: Record<string, unknown> = {}) {
  return {
    current: { id: name, name, contentProperties: [], designProperties: [], slots: [] },
    proposed: {},
    hasPendingDraftChanges: false,
    ...extra,
  };
}

describe('buildSummaryLines', () => {
  it('keeps every component name available to the bounded scroll view', () => {
    const preview = makePreview({
      components: {
        new: [{ key: 'NewComponent' }],
        changed: [changedComponent('ChangedComponent')],
        removed: [{ name: 'RemovedComponent' }],
        unchanged: [],
      },
    });

    const lines = buildSummaryLines(preview).map((line) => line.text);
    expect(lines).toEqual(expect.arrayContaining(['  + NewComponent', ' ~ ChangedComponent', ' ⊘ RemovedComponent']));
  });

  it('counts each group with the right verb', () => {
    const preview = makePreview({
      components: { new: [{ key: 'A' }, { key: 'B' }], changed: [], removed: [], unchanged: [{}] },
      tokens: { new: [{}], changed: [{}, {}], removed: [{}], unchanged: [{}, {}, {}] },
    });

    const lines = buildSummaryLines(preview).map((line) => line.text);
    expect(lines).toContain(' ＋ 2 components will be created');
    expect(lines).toContain(' · 1 unchanged');
    expect(lines).toContain(' ＋ 1 design tokens will be created');
    expect(lines).toContain(' ～ 2 design tokens will be updated');
    expect(lines).toContain(' ⊘ 1 design tokens will be skipped');
    expect(lines).toContain(' · 3 design tokens unchanged');
  });

  it('marks a breaking change with a warning sign in the error colour', () => {
    const preview = makePreview({
      components: {
        new: [],
        changed: [
          changedComponent('Hero', { changeClassification: { classification: 'breaking', breakingChanges: [] } }),
          changedComponent('Card'),
        ],
        removed: [],
        unchanged: [],
      },
    });

    const lines = buildSummaryLines(preview);
    const hero = lines.find((line) => line.text.includes('Hero'));
    const card = lines.find((line) => line.text.includes('Card'));
    expect(hero?.text).toBe(' ⚠ Hero');
    expect(card?.text).toBe(' ~ Card');
    expect(hero?.color).not.toBe(card?.color);
  });

  it('falls back to "unknown" for a new component with no name', () => {
    const lines = buildSummaryLines(
      makePreview({ components: { new: [{}], changed: [], removed: [], unchanged: [] } }),
    );
    expect(lines.map((line) => line.text)).toContain('  + unknown');
  });

  it('returns nothing for an empty preview', () => {
    expect(buildSummaryLines(makePreview())).toEqual([]);
  });
});

describe('buildDiffLines', () => {
  it('lists a new component with its slots and allowed components', () => {
    const preview = makePreview({
      components: {
        new: [{ key: 'Layout', $slots: { main: { $allowedComponents: ['Hero', 'Card'] }, aside: {} } }],
        changed: [],
        removed: [],
        unchanged: [],
      },
    });

    const lines = buildDiffLines(preview).map((line) => line.text);
    expect(lines).toEqual([' + Layout', '   slot: aside', '   slot: main', '     allowedComponents: [Hero, Card]']);
  });

  it('lists removed components and tokens', () => {
    const preview = makePreview({
      components: { new: [], changed: [], removed: [{ name: 'OldCard' }], unchanged: [] },
      tokens: { new: [], changed: [], removed: [{ name: 'color.old' }], unchanged: [] },
    });

    const lines = buildDiffLines(preview).map((line) => line.text);
    expect(lines).toEqual([' - OldCard', ' - color.old']);
  });

  it('flags pending draft changes on a changed component', () => {
    const preview = makePreview({
      components: {
        new: [],
        changed: [changedComponent('Hero', { hasPendingDraftChanges: true })],
        removed: [],
        unchanged: [],
      },
    });

    expect(buildDiffLines(preview)[0]?.text).toBe(' ~ Hero ⚡ has pending draft changes');
  });

  it('spells out each breaking change by slot or property id', () => {
    const preview = makePreview({
      components: {
        new: [],
        changed: [
          changedComponent('Hero', {
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [
                { propertyId: 'title', reason: 'type changed' },
                { slotId: 'body', reason: 'slot removed' },
              ],
            },
          }),
        ],
        removed: [],
        unchanged: [],
      },
    });

    const lines = buildDiffLines(preview).map((line) => line.text);
    expect(lines).toContain(' ⚠ BREAKING: title: type changed, body: slot removed');
  });

  it('shows added properties for a changed component', () => {
    const preview = makePreview({
      components: {
        new: [],
        changed: [changedComponent('Hero', { proposed: { $properties: { title: { $type: 'String' } } } })],
        removed: [],
        unchanged: [],
      },
    });

    expect(buildDiffLines(preview).map((line) => line.text)).toContain(' + title: String, optional');
  });

  it('lists the proposed allowed components of a changed component slot', () => {
    const preview = makePreview({
      components: {
        new: [],
        changed: [
          changedComponent('Layout', {
            current: {
              id: 'Layout',
              name: 'Layout',
              contentProperties: [],
              designProperties: [],
              slots: ['main'],
              currentSlotAllowed: { main: ['Hero'] },
            },
            proposed: { $slots: { main: { $allowedComponents: ['Hero', 'Card'] } } },
          }),
        ],
        removed: [],
        unchanged: [],
      },
    });

    const lines = buildDiffLines(preview).map((line) => line.text);
    expect(lines).toContain('   slot main allowedComponents: [Hero, Card]');
  });

  it('lists new and changed tokens', () => {
    const preview = makePreview({
      tokens: {
        new: [{ name: 'color.brand' }, { path: 'space.4' }],
        changed: [{ current: { name: 'color.text' }, hasPendingDraftChanges: false }],
        removed: [],
        unchanged: [],
      },
    });

    const lines = buildDiffLines(preview).map((line) => line.text);
    expect(lines).toEqual([' + color.brand', ' + space.4', ' ~ color.text']);
  });

  it('gives every line a unique key', () => {
    const preview = makePreview({
      components: {
        new: [{ key: 'A', $slots: { s: { $allowedComponents: ['B'] } } }],
        changed: [changedComponent('C', { hasPendingDraftChanges: true })],
        removed: [{ name: 'D' }],
        unchanged: [],
      },
      tokens: { new: [{ name: 'T' }], changed: [], removed: [{ name: 'U' }], unchanged: [] },
    });

    const keys = buildDiffLines(preview).map((line) => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('hasChanges', () => {
  it('is false when everything is unchanged', () => {
    const preview = makePreview({
      components: { new: [], changed: [], removed: [], unchanged: [{}] },
      tokens: { new: [], changed: [], removed: [], unchanged: [{}] },
    });
    expect(hasChanges(preview)).toBe(false);
  });

  it('is true for a new, changed or removed component', () => {
    expect(hasChanges(makePreview({ components: { new: [{}], changed: [], removed: [], unchanged: [] } }))).toBe(true);
    expect(hasChanges(makePreview({ components: { new: [], changed: [{}], removed: [], unchanged: [] } }))).toBe(true);
    expect(hasChanges(makePreview({ components: { new: [], changed: [], removed: [{}], unchanged: [] } }))).toBe(true);
  });

  it('is true for a token change on its own', () => {
    expect(hasChanges(makePreview({ tokens: { new: [{}], changed: [], removed: [], unchanged: [] } }))).toBe(true);
  });
});

describe('previewAction', () => {
  it('confirms on Enter and quits on Esc', () => {
    expect(previewAction('', { ...NO_KEY, return: true }, false)).toBe('confirm');
    expect(previewAction('', { ...NO_KEY, escape: true }, false)).toBe('quit');
  });

  it('does not treat q as quit', () => {
    expect(previewAction('q', NO_KEY, false)).toBeNull();
  });

  it('toggles the diff on d or D and edits on e or E', () => {
    expect(previewAction('d', NO_KEY, false)).toBe('toggle-diff');
    expect(previewAction('D', NO_KEY, true)).toBe('toggle-diff');
    expect(previewAction('e', NO_KEY, false)).toBe('edit');
    expect(previewAction('E', NO_KEY, false)).toBe('edit');
  });

  it('scrolls with arrows and f/b in either mode', () => {
    expect(previewAction('', { ...NO_KEY, upArrow: true }, false)).toBe('scroll');
    expect(previewAction('', { ...NO_KEY, downArrow: true }, true)).toBe('scroll');
    expect(previewAction('f', NO_KEY, false)).toBe('scroll');
    expect(previewAction('b', NO_KEY, true)).toBe('scroll');
  });

  it('scrolls with j and k only while the diff is expanded', () => {
    expect(previewAction('j', NO_KEY, true)).toBe('scroll');
    expect(previewAction('k', NO_KEY, true)).toBe('scroll');
    expect(previewAction('j', NO_KEY, false)).toBeNull();
    expect(previewAction('k', NO_KEY, false)).toBeNull();
  });

  it('ignores other keys', () => {
    expect(previewAction('x', NO_KEY, false)).toBeNull();
  });
});

describe('nextScrollOffset', () => {
  const scroll = { offset: 5, viewportHeight: 4, maxScroll: 10 };

  it('moves one line with the arrows', () => {
    expect(nextScrollOffset('', { ...NO_KEY, downArrow: true }, false, scroll)).toBe(6);
    expect(nextScrollOffset('', { ...NO_KEY, upArrow: true }, false, scroll)).toBe(4);
  });

  it('moves one line with j and k only while the diff is expanded', () => {
    expect(nextScrollOffset('j', NO_KEY, true, scroll)).toBe(6);
    expect(nextScrollOffset('k', NO_KEY, true, scroll)).toBe(4);
    expect(nextScrollOffset('j', NO_KEY, false, scroll)).toBe(5);
  });

  it('moves a page with f and b', () => {
    expect(nextScrollOffset('f', NO_KEY, false, scroll)).toBe(9);
    expect(nextScrollOffset('b', NO_KEY, false, scroll)).toBe(1);
  });

  it('stays inside 0..maxScroll', () => {
    expect(nextScrollOffset('f', NO_KEY, false, { ...scroll, offset: 9 })).toBe(10);
    expect(nextScrollOffset('', { ...NO_KEY, downArrow: true }, false, { ...scroll, offset: 10 })).toBe(10);
    expect(nextScrollOffset('b', NO_KEY, false, { ...scroll, offset: 2 })).toBe(0);
    expect(nextScrollOffset('', { ...NO_KEY, upArrow: true }, false, { ...scroll, offset: 0 })).toBe(0);
  });

  it('leaves the offset alone for other keys', () => {
    expect(nextScrollOffset('x', NO_KEY, true, scroll)).toBe(5);
  });
});

describe('scrollIndicator', () => {
  it('is blank when everything fits', () => {
    expect(scrollIndicator(3, 0, 10)).toBe(' ');
  });

  it('shows lines below at the top', () => {
    expect(scrollIndicator(20, 0, 5)).toBe(' ↓ 15 below');
  });

  it('shows lines above at the bottom', () => {
    expect(scrollIndicator(20, 15, 5)).toBe(' ↑ 15 above');
  });

  it('shows both in the middle', () => {
    expect(scrollIndicator(20, 5, 5)).toBe(' ↑ 5 above · ↓ 10 below');
  });
});

describe('viewportHeight', () => {
  it('leaves room for the header, panel border and footer', () => {
    expect(viewportHeight(40, false)).toBe(24);
  });

  it('reserves two more rows for the breaking-change notice', () => {
    expect(viewportHeight(40, true)).toBe(22);
  });

  it('never drops below a usable minimum on a short terminal', () => {
    expect(viewportHeight(18, false)).toBe(3);
    expect(viewportHeight(0, true)).toBe(3);
  });
});
