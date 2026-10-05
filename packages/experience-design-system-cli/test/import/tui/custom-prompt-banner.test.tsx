import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { CustomPromptBanner } from '../../../src/import/tui/CustomPromptBanner.js';

describe('CustomPromptBanner (Feature 8)', () => {
  it('renders nothing when neither path is set', () => {
    const { lastFrame } = render(<CustomPromptBanner />);
    expect(lastFrame() ?? '').toBe('');
  });

  it('renders the generate path when only generatePromptPath is set', () => {
    const { lastFrame } = render(<CustomPromptBanner generatePromptPath="/tmp/x-gen.md" />);
    const out = lastFrame() ?? '';
    expect(out).toContain('/tmp/x-gen.md');
    expect(out).toContain('components');
  });
});
