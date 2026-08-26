import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { collectTokenSuggestions, TokenReviewPanel } from '../../../../../src/analyze/select/tui/components/TokenReviewPanel.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

const ENTRY: CDFComponentEntry = {
  $type: 'component',
  $properties: {
    bgColor: {
      $type: 'token',
      $category: 'design',
      '$token.kind': 'color',
      '$token.sets': ['colors.surface.default', 'colors.surface.raised'],
      '$token.allowed': ['colors.surface.default'],
    },
    label: { $type: 'string', $category: 'content' },
    borderColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
  },
};

describe('collectTokenSuggestions', () => {
  it('returns only design-token props that carry a $token.sets suggestion', () => {
    expect(collectTokenSuggestions(ENTRY)).toEqual([
      { propName: 'bgColor', sets: ['colors.surface.default', 'colors.surface.raised'], allowed: ['colors.surface.default'] },
    ]);
  });

  it('excludes design-token props with no $token.sets (nothing suggested yet)', () => {
    const only = collectTokenSuggestions(ENTRY);
    expect(only.find((s) => s.propName === 'borderColor')).toBeUndefined();
  });

  it('defaults allowed to an empty array when $token.allowed is absent', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        fg: { $type: 'token', $category: 'design', '$token.sets': ['colors.text.default'] },
      },
    };
    expect(collectTokenSuggestions(entry)).toEqual([{ propName: 'fg', sets: ['colors.text.default'], allowed: [] }]);
  });
});

describe('TokenReviewPanel — list mode', () => {
  const suggestions = [
    { propName: 'bgColor', sets: ['colors.surface.default', 'colors.surface.raised'], allowed: ['colors.surface.default'] },
    { propName: 'textColor', sets: ['colors.text.default'], allowed: [] },
  ];

  it('renders header with component name and one row per suggestion', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{}}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        canUndoDismiss={false}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/TOKEN REVIEW/i);
    expect(out).toContain('Card');
    expect(out).toContain('bgColor');
    expect(out).toContain('textColor');
    expect(out).toContain('colors.surface.default');
  });

  it('marks an accepted row distinctly from a pending one', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{ bgColor: 'accepted' }}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        canUndoDismiss={false}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/✓/);
  });

  it('highlights the selected row and shows the keyboard legend', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{}}
        selectedRow={1}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        canUndoDismiss={false}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/\[a\] accept/);
    expect(out).toMatch(/\[x\] dismiss/);
    expect(out).toMatch(/\[Enter\] edit/);
  });

  it('omits the [u] undo hint when nothing can be restored', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{}}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        canUndoDismiss={false}
        width={60}
        height={20}
        active={true}
      />,
    );
    expect(lastFrame() ?? '').not.toMatch(/\[u\] undo/);
  });

  it('shows the [u] undo hint when a dismissed prop can be restored', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{}}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        canUndoDismiss={true}
        width={60}
        height={20}
        active={true}
      />,
    );
    expect(lastFrame() ?? '').toMatch(/\[u\] undo/);
  });
});

describe('TokenReviewPanel — edit mode', () => {
  const suggestions = [
    { propName: 'bgColor', sets: ['colors.surface.default', 'colors.surface.raised', 'colors.brand.primary'], allowed: ['colors.surface.default'] },
  ];

  it('renders every path in $token.sets as a checkbox row, checked iff in editSelection', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        decisions={{}}
        selectedRow={0}
        editing={true}
        editCursor={0}
        editSelection={new Set(['colors.surface.default'])}
        canUndoDismiss={false}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('colors.surface.default');
    expect(out).toContain('colors.surface.raised');
    expect(out).toContain('colors.brand.primary');
    expect(out).toMatch(/\[x\].*colors\.surface\.default/);
    expect(out).toMatch(/\[ \].*colors\.surface\.raised/);
    expect(out).toMatch(/\[Ctrl\+S\] save/);
    expect(out).toMatch(/\[Esc\] cancel/);
  });
});
