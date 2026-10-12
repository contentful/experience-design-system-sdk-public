import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { ExtractionScreen } from '../../../src/tui/import/steps/06-extraction/screen.js';
import { initialProgress } from '../../../src/tui/import/steps/06-extraction/logic.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const plain = (frame: string | undefined): string => (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
async function frameOf(element: React.ReactElement): Promise<string> {
  const view = render(element);
  await tick();
  return plain(view.lastFrame());
}

describe('ExtractionScreen', () => {
  const fresh = initialProgress({ hasCredentials: true, hasRawTokens: true, reuseTokens: false });

  it('titles the step with its place in the import', async () => {
    const frame = await frameOf(<ExtractionScreen progress={fresh} agent="claude" stepNumber={2} totalSteps={6} />);
    expect(frame).toContain('Step 2 of 6 — Extracting context');
    expect(frame).toContain('Extracting context from your source files.');
  });

  it('shows a row for each job on the first frame, using the chosen agent', async () => {
    const frame = await frameOf(<ExtractionScreen progress={fresh} agent="codex" stepNumber={2} totalSteps={6} />);
    expect(frame).toContain('Scanning files...');
    expect(frame).toContain('Mapping composition via codex...');
    expect(frame).toContain('Filtering component selection via codex...');
    expect(frame).toContain('Fetching existing components and tokens...');
    expect(frame).toContain('Generating token definitions via codex...');
  });

  it('ticks off the jobs that have finished', async () => {
    const done = {
      ...fresh,
      scan: { scanned: 40, total: 40 },
      composition: 'cache-hit' as const,
      selection: 'complete' as const,
      existingEntities: 'complete' as const,
      tokens: 'complete' as const,
    };
    const frame = await frameOf(<ExtractionScreen progress={done} agent="claude" stepNumber={2} totalSteps={6} />);
    expect(frame).toContain('✓ Scanned 40 files');
    expect(frame).toContain('✓ Composition mapping (cached)');
    expect(frame).toContain('✓ Selection agent complete');
    expect(frame).toContain('✓ Existing components and tokens ready');
    expect(frame).toContain('✓ Token definitions ready');
  });

  it('leaves out the rows for jobs that do not apply', async () => {
    const bare = initialProgress({ hasCredentials: false, hasRawTokens: false, reuseTokens: false });
    const frame = await frameOf(<ExtractionScreen progress={bare} agent="claude" stepNumber={1} totalSteps={5} />);
    expect(frame).not.toContain('existing components');
    expect(frame).not.toContain('token definitions');
    expect(frame).toContain('Step 1 of 5');
  });
});
