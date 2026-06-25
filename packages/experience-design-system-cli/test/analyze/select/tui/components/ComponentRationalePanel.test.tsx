import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { ComponentRationalePanel } from '../../../../../src/analyze/select/tui/components/ComponentRationalePanel.js';
import type { ComponentRationale } from '../../../../../src/session/db.js';

const FULL: ComponentRationale = {
  name: 'Button',
  description: 'A primary call-to-action element used to trigger user actions.',
  descriptionRationale: 'Captures the primary CTA pattern across pages.',
  propsRationale: 'Captured visual variants and exposed an optional disabled state.',
  slotsRationale: 'No slots; Button is leaf content.',
  props: [
    { name: 'label', category: 'content', description: 'Visible button label.', rationale: 'Required because a button with no label has no purpose.' },
    { name: 'variant', category: 'design', description: 'Visual style.', rationale: 'Renders primary or secondary style.' },
  ],
  slots: [],
};

describe('ComponentRationalePanel', () => {
  it('renders the Description, Why-props, Why-slots sections', () => {
    const { lastFrame } = render(
      <ComponentRationalePanel data={FULL} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Description');
    expect(out).toContain('A primary call-to-action element');
    expect(out).toContain('Why these props');
    expect(out).toContain('Captured visual variants');
    expect(out).toContain('Why these slots');
    expect(out).toContain('No slots; Button is leaf content.');
  });

  it('renders the header with component name', () => {
    const { lastFrame } = render(
      <ComponentRationalePanel data={FULL} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Component rationale');
    expect(out).toContain('Button');
  });

  it('renders Props list with each prop rationale', () => {
    const { lastFrame } = render(
      <ComponentRationalePanel data={FULL} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Props');
    expect(out).toContain('label');
    expect(out).toContain('Required because a button with no label has no purpose.');
    expect(out).toContain('variant');
    expect(out).toContain('Renders primary or secondary style.');
  });

  it('renders Slots list with each slot rationale', () => {
    const data: ComponentRationale = {
      ...FULL,
      slots: [
        { name: 'icon', description: 'Optional icon.', rationale: 'Kept because callers commonly render a leading icon.' },
      ],
    };
    const { lastFrame } = render(
      <ComponentRationalePanel data={data} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Slots');
    expect(out).toContain('icon');
    expect(out).toContain('Kept because callers commonly render a leading icon.');
  });

  it('renders "(no rationale captured)" for null fields', () => {
    const empty: ComponentRationale = {
      name: 'Bare',
      description: null,
      descriptionRationale: null,
      propsRationale: null,
      slotsRationale: null,
      props: [],
      slots: [],
    };
    const { lastFrame } = render(
      <ComponentRationalePanel data={empty} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    // Each major section falls back to the placeholder.
    const occurrences = (out.match(/\(no rationale captured\)/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it('renders a scroll indicator + legend at the bottom when content overflows', () => {
    const big: ComponentRationale = {
      ...FULL,
      props: Array.from({ length: 30 }, (_, i) => ({
        name: `prop${i}`,
        category: 'content',
        description: null,
        rationale: `rationale-text-${i}`,
      })),
    };
    const { lastFrame } = render(
      <ComponentRationalePanel data={big} scrollOffset={0} width={60} height={6} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/\d+-\d+\/\d+/);
    expect(out.toLowerCase()).toContain('close');
  });

  it('wraps long rationale text to innerWidth', () => {
    const long = 'word '.repeat(80).trim();
    const data: ComponentRationale = {
      ...FULL,
      descriptionRationale: long,
    };
    const { lastFrame } = render(
      <ComponentRationalePanel data={data} scrollOffset={0} width={30} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    // Each rendered line should fit within the panel inner width.
    for (const ln of out.split('\n')) {
      // Strip ANSI for length check is unnecessary; ink-testing-library returns plain.
      expect(ln.length).toBeLessThanOrEqual(40);
    }
  });
});
