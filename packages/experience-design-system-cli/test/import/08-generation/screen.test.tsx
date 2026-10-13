import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { GenerationScreen } from '../../../src/tui/import/steps/08-generation/screen.js';
import { initialProgress } from '../../../src/tui/import/steps/08-generation/logic.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const plain = (frame: string | undefined): string => (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
async function frameOf(element: React.ReactElement): Promise<string> {
  const view = render(element);
  await tick();
  return plain(view.lastFrame());
}

describe('GenerationScreen', () => {
  const props = { agent: 'claude', acceptedCount: 5, hasTokens: false, stepNumber: 4, totalSteps: 6 };

  it('titles the step with its place in the import', async () => {
    const frame = await frameOf(<GenerationScreen {...props} progress={initialProgress()} />);
    expect(frame).toContain('Step 4 of 6 — Generating definitions');
  });

  it('says what was accepted and what is happening to it', async () => {
    const frame = await frameOf(<GenerationScreen {...props} progress={initialProgress()} />);
    expect(frame).toContain('5 components accepted.');
    expect(frame).toContain(
      "Claude is mapping your selected components to Contentful's Component Definition Format (CDF).",
    );
  });

  it('mentions the tokens when there are some', async () => {
    const frame = await frameOf(<GenerationScreen {...props} hasTokens progress={initialProgress()} />);
    expect(frame).toContain('Using your design tokens for prop resolution.');
  });

  it('starts with the agent starting up', async () => {
    const frame = await frameOf(<GenerationScreen {...props} progress={initialProgress()} />);
    expect(frame).toContain('Starting up Claude...');
  });

  it('shows the component being worked on with its count', async () => {
    const frame = await frameOf(
      <GenerationScreen
        {...props}
        progress={{ components: { done: 3, total: 5, current: 'Modal' }, mapTokens: 'idle', mapTokensEligible: null }}
      />,
    );
    expect(frame).toContain('Modal');
    expect(frame).toContain('3/5');
  });

  it('shows token mapping once it starts, and ticks it off when done', async () => {
    const running = await frameOf(
      <GenerationScreen
        {...props}
        progress={{
          components: { done: 5, total: 5, current: 'Modal' },
          mapTokens: 'running',
          mapTokensEligible: true,
        }}
      />,
    );
    expect(running).toContain('Mapping token restrictions via Claude...');
    const complete = await frameOf(
      <GenerationScreen
        {...props}
        progress={{
          components: { done: 5, total: 5, current: 'Modal' },
          mapTokens: 'complete',
          mapTokensEligible: true,
        }}
      />,
    );
    expect(complete).toContain('Token restrictions ready');
  });
});
