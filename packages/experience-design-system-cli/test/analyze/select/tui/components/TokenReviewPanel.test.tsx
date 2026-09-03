import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import {
  collectTokenSuggestions,
  TokenReviewPanel,
} from '../../../../../src/analyze/select/tui/components/TokenReviewPanel.js';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

const ENTRY: CDFComponentEntry = {
  $type: 'component',
  $properties: {
    bgColor: {
      $type: 'token',
      $category: 'design',
      '$token.kind': 'color',
      '$token.allowed': ['colors.surface.default', 'colors.surface.raised'],
    },
    label: { $type: 'string', $category: 'content' },
    borderColor: { $type: 'token', $category: 'design', '$token.kind': 'color' },
  },
};

describe('collectTokenSuggestions', () => {
  it('returns only design-token props that carry a non-empty $token.allowed suggestion', () => {
    expect(collectTokenSuggestions(ENTRY)).toEqual([
      {
        propName: 'bgColor',
        paths: ['colors.surface.default', 'colors.surface.raised'],
        suggested: ['colors.surface.default', 'colors.surface.raised'],
        allowed: ['colors.surface.default', 'colors.surface.raised'],
      },
    ]);
  });

  it('includes every token whose type matches the property kind', () => {
    expect(
      collectTokenSuggestions(ENTRY, [
        { path: 'colors.surface.default', kind: 'color' },
        { path: 'colors.brand.primary', kind: 'color' },
        { path: 'colors.surface.raised', kind: 'color' },
        { path: 'spacing.small', kind: 'dimension' },
      ])[0],
    ).toEqual({
      propName: 'bgColor',
      paths: ['colors.surface.default', 'colors.brand.primary', 'colors.surface.raised'],
      suggested: ['colors.surface.default', 'colors.surface.raised'],
      allowed: ['colors.surface.default', 'colors.surface.raised'],
    });
  });

  it('excludes persisted allowed paths that do not match the property kind when a catalog is available', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        bgColor: {
          $type: 'token',
          $category: 'design',
          '$token.kind': 'color',
          '$token.allowed': ['colors.surface.default', 'spacing.small'],
        },
      },
    };

    expect(
      collectTokenSuggestions(entry, [
        { path: 'colors.surface.default', kind: 'color' },
        { path: 'colors.brand.primary', kind: 'color' },
        { path: 'spacing.small', kind: 'dimension' },
      ]),
    ).toEqual([
      {
        propName: 'bgColor',
        paths: ['colors.surface.default', 'colors.brand.primary'],
        suggested: ['colors.surface.default'],
        allowed: ['colors.surface.default'],
      },
    ]);
  });

  it('excludes design-token props with no $token.allowed (nothing suggested yet)', () => {
    const only = collectTokenSuggestions(ENTRY);
    expect(only.find((s) => s.propName === 'borderColor')).toBeUndefined();
  });

  it('excludes a token prop when $token.allowed is absent', () => {
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {
        fg: { $type: 'token', $category: 'design' },
      },
    };
    expect(collectTokenSuggestions(entry)).toEqual([]);
  });
});

describe('TokenReviewPanel — list mode', () => {
  const suggestions = [
    {
      propName: 'bgColor',
      paths: ['colors.surface.default', 'colors.surface.raised'],
      suggested: ['colors.surface.default', 'colors.surface.raised'],
      allowed: ['colors.surface.default'],
    },
    {
      propName: 'textColor',
      paths: ['colors.text.default'],
      suggested: ['colors.text.default'],
      allowed: ['colors.text.default'],
    },
  ];

  it('renders header with component name and one row per suggestion', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
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

  it('renders each prop name and keeps suggested separate from allowed', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        selectedRow={0}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('bgColor');
    expect(out).toContain('textColor');
    expect(out).toContain('suggested: colors.surface.default, colors.surface.raised');
    expect(out).toContain('allowed: colors.surface.default');
  });

  it('highlights the selected row and shows the keyboard legend', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        selectedRow={1}
        editing={false}
        editCursor={0}
        editSelection={new Set()}
        width={60}
        height={20}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/\[Enter\] edit allowed/);
    expect(out).toMatch(/\[Esc\] close/);
    expect(out).not.toMatch(/accept|dismiss|undo/);
  });
});

describe('TokenReviewPanel — edit mode', () => {
  const suggestions = [
    {
      propName: 'bgColor',
      paths: ['colors.surface.default', 'colors.surface.raised', 'colors.brand.primary'],
      suggested: ['colors.surface.default', 'colors.surface.raised'],
      allowed: ['colors.surface.default'],
    },
  ];

  it('renders every suggested path as a checkbox row, checked iff in editSelection', () => {
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={suggestions}
        selectedRow={0}
        editing={true}
        editCursor={0}
        editSelection={new Set(['colors.surface.default'])}
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

  it('scrolls the token viewport to keep a focused compatible token visible', () => {
    const paths = Array.from({ length: 20 }, (_, i) => `colors.scale.${i}`);
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="Card"
        suggestions={[
          {
            propName: 'bgColor',
            paths,
            suggested: [paths[0]!],
            allowed: [paths[0]!],
          },
        ]}
        selectedRow={0}
        editing={true}
        editCursor={15}
        editSelection={new Set([paths[0]!])}
        width={60}
        height={10}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('colors.scale.15');
    expect(out).not.toContain('colors.scale.0');
    expect(out).toContain('14-17 of 20');
  });

  it('keeps the viewport and commands visible when token paths exceed the panel width', () => {
    const longPath = 'colors.really.long.token.path.that.must.not.wrap.inside.the.review.viewport';
    const { lastFrame } = render(
      <TokenReviewPanel
        componentName="VeryLongComponentName"
        suggestions={[
          {
            propName: 'veryLongTokenPropertyName',
            paths: [longPath],
            suggested: [longPath],
            allowed: [longPath],
          },
        ]}
        selectedRow={0}
        editing={true}
        editCursor={0}
        editSelection={new Set([longPath])}
        width={30}
        height={10}
        active={true}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('[↑/↓] move  [Space] toggle');
    expect(out).toContain('[Ctrl+S] save  [Esc] cancel');
    expect(out.split('\n')).toHaveLength(12);
  });
});
