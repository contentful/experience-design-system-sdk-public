import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { HANDOFF_ENV, serializeHandoff, type ImportHandoff } from '@contentful/experience-design-system-types/handoff';

// The CLI now does everything up to the review: extraction, the scope gate, saving the decisions, generating and mapping
// tokens. What is left for the wizard is where it begins, so these check that, for each thing the CLI can say.
vi.mock('../../../src/import/tui/steps/GenerateReviewStep.js', () => ({
  GenerateReviewStep: (props: { extractSessionId: string | null; tokenSessionId: string | null }) => (
    <Text>{`FINAL_REVIEW session=${props.extractSessionId}`}</Text>
  ),
}));

vi.mock('../../../src/runs/path-prompt.js', () => ({
  PathPrompt: () => <Text>SAVE_PATH_PROMPT</Text>,
}));

vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

const extraction = {
  sessionId: 'extract-1',
  outDir: '/tmp/proj/.contentful',
  tokensPath: '/tmp/proj/.contentful/tokens.json',
  tokenSessionId: null,
  tokenCount: 0,
  existingEntitiesPath: null,
  existingEntitiesStatus: 'idle',
  compositionPhase: 'done',
} as const;

const handoffWith = (generation: ImportHandoff['generation']): ImportHandoff => ({
  credentialsSkipped: true,
  tokens: { strategy: 'generate' },
  extraction,
  ...(generation ? { generation } : {}),
});

async function start(handoff: ImportHandoff | undefined): Promise<string> {
  if (handoff) process.env[HANDOFF_ENV] = serializeHandoff(handoff);
  const { WizardApp } = await import('../../../src/import/tui/WizardApp.js');
  const app = render(<WizardApp initialProjectPath="/tmp/proj" />);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const frame = app.lastFrame() ?? '';
  app.unmount();
  return frame;
}

describe('where the wizard begins', () => {
  afterEach(() => {
    delete process.env[HANDOFF_ENV];
  });

  it('opens the review screen on the extraction session when definitions were generated', async () => {
    const frame = await start(
      handoffWith({
        route: 'review',
        sessionId: 'gen-1',
        acceptedCount: 2,
        generatedCount: 2,
        mapTokensEligible: false,
      }),
    );
    expect(frame).toContain('FINAL_REVIEW');
  });

  it('goes straight to saving and pushing when nothing was accepted, without showing the review', async () => {
    const frame = await start(handoffWith({ route: 'push', acceptedCount: 0 }));
    expect(frame).not.toContain('FINAL_REVIEW');
    expect(frame).toContain('SAVE_PATH_PROMPT');
  });

  it('says so when the CLI did not hand over the generated definitions', async () => {
    const frame = await start(handoffWith(undefined));
    expect(frame).toContain('did not hand over the generated definitions');
  });

  it('says it must be started by the CLI when there is no handoff at all', async () => {
    const frame = await start(undefined);
    expect(frame).toMatch(/must be started by the CLI/);
  });
});
