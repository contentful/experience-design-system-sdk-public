import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { RationalePanel } from '../../../../../src/analyze/select/tui/components/RationalePanel.js';

const rows = [
  { name: 'title', kind: 'prop' as const, rationale: 'Primary heading shown at the top of the card.' },
  { name: 'body', kind: 'prop' as const, rationale: 'Long-form description of the card contents.' },
  { name: 'cta', kind: 'slot' as const, rationale: 'Optional call-to-action slot rendered below the body.' },
];

describe('RationalePanel', () => {
  it('renders header with component name', () => {
    const { lastFrame } = render(
      <RationalePanel componentName="HeroCard" rows={rows} scrollOffset={0} width={60} height={20} active={true} />,
    );
    expect(lastFrame() ?? '').toContain('RATIONALE');
    expect(lastFrame() ?? '').toContain('HeroCard');
  });

  it('renders one row per prop/slot with name and rationale text', () => {
    const { lastFrame } = render(
      <RationalePanel componentName="HeroCard" rows={rows} scrollOffset={0} width={80} height={40} active={true} />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('title');
    expect(out).toContain('Primary heading shown at the top of the card.');
    expect(out).toContain('body');
    expect(out).toContain('Long-form description of the card contents.');
    expect(out).toContain('cta');
    expect(out).toContain('Optional call-to-action slot rendered below the body.');
  });

  it('clips initial lines when scrollOffset > 0', () => {
    // Build many rows so panel must scroll
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `prop${i}`,
      kind: 'prop' as const,
      rationale: `rationale-text-${i}`,
    }));
    const { lastFrame } = render(
      <RationalePanel componentName="HeroCard" rows={many} scrollOffset={6} width={60} height={5} active={true} />,
    );
    const out = lastFrame() ?? '';
    // First few rationales should be scrolled off
    expect(out).not.toContain('rationale-text-0');
    expect(out).not.toContain('rationale-text-1');
  });

  it('renders scroll indicator when content overflows', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `prop${i}`,
      kind: 'prop' as const,
      rationale: `rationale-${i}`,
    }));
    const { lastFrame } = render(
      <RationalePanel componentName="HeroCard" rows={many} scrollOffset={0} width={60} height={5} active={true} />,
    );
    expect(lastFrame() ?? '').toMatch(/↕\s*1-\d+\/\d+/);
  });
});
