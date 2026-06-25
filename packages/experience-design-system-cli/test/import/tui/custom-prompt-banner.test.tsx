import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CustomPromptBanner } from '../../../src/import/tui/CustomPromptBanner.js';

describe('CustomPromptBanner (Feature 8)', () => {
  it('renders nothing when neither path is set', () => {
    const { lastFrame } = render(<CustomPromptBanner />);
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders the select path when only selectPromptPath is set', () => {
    const { lastFrame } = render(<CustomPromptBanner selectPromptPath="/tmp/x-select.md" />);
    const out = lastFrame() ?? '';
    expect(out).toMatch(/Custom prompt active/i);
    expect(out).toContain('/tmp/x-select.md');
    expect(out).toContain('select');
    expect(out).not.toMatch(/\bcomponents\b.*custom prompt/i);
  });

  it('renders the generate path when only generatePromptPath is set', () => {
    const { lastFrame } = render(<CustomPromptBanner generatePromptPath="/tmp/x-gen.md" />);
    const out = lastFrame() ?? '';
    expect(out).toContain('/tmp/x-gen.md');
    expect(out).toContain('components');
  });

  it('renders both paths when both are set', () => {
    const { lastFrame } = render(
      <CustomPromptBanner selectPromptPath="/tmp/sel.md" generatePromptPath="/tmp/gen.md" />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('/tmp/sel.md');
    expect(out).toContain('/tmp/gen.md');
    expect(out).toMatch(/bundled invariants.*do NOT apply/i);
  });
});
