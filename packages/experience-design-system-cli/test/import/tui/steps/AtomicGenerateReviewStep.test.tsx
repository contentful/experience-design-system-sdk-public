import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const SAMPLE_ENTRY = {
  $type: 'component' as const,
  $description: 'A button component',
  $properties: {
    variant: {
      $type: 'enum' as const,
      $category: 'content' as const,
      $description: 'Visual style',
      $values: ['primary', 'secondary'],
    },
  },
};

vi.mock('../../../../src/session/db.js', () => ({
  openPipelineDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
    exec: vi.fn(),
    close: vi.fn(),
  }),
  loadCDFComponents: vi.fn().mockReturnValue([
    { key: 'Button', entry: SAMPLE_ENTRY },
    { key: 'Card', entry: { $type: 'component', $properties: {} } },
  ]),
  storeCDFComponents: vi.fn(),
  loadComponentReviewMetadata: vi.fn().mockReturnValue({
    sourcePath: '/repo/src/Button.tsx',
    componentSource: 'export const Button = () => <button/>;\nconst x = 1;\n',
  }),
  loadComponentRationale: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/import/tui/useLivePreview.js', () => ({
  useLivePreview: () => ({ trigger: vi.fn(), status: 'idle' as const, disabled: true }),
}));

let AtomicGenerateReviewStep: typeof import('../../../../src/import/tui/steps/AtomicGenerateReviewStep.js').AtomicGenerateReviewStep;

beforeEach(async () => {
  const mod = await import('../../../../src/import/tui/steps/AtomicGenerateReviewStep.js');
  AtomicGenerateReviewStep = mod.AtomicGenerateReviewStep;
});

const CTRL_Z = '\x1a';
const CTRL_Y = '\x19';
const CTRL_R = '\x12';

async function tick() {
  await new Promise((r) => setTimeout(r, 30));
}

function renderStep() {
  return render(
    <AtomicGenerateReviewStep extractSessionId="s1" onFinalize={() => {}} onQuit={() => {}} livePreview={false} />,
  );
}

describe('AtomicGenerateReviewStep — source panel + undo/redo/reload', () => {
  it('opens the source panel on [s] from the base (sidebar) state', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('s');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/source:/i);
    expect(frame).toContain('/repo/src/Button.tsx');
  });

  it('advertises undo/redo/reload in the footer legend', async () => {
    const { lastFrame } = renderStep();
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/undo/i);
    expect(frame).toMatch(/redo/i);
    expect(frame).toMatch(/reload/i);
  });

  it('Ctrl+R opens the reload confirmation dialog', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(lastFrame() ?? '').toMatch(/Reload from saved state\?/i);
  });

  it('undo reverts a status change and redo re-applies it', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    // Accept the focused component → 1 accepted.
    stdin.write('a');
    await tick();
    expect(lastFrame() ?? '').toMatch(/1\b/);
    // Undo → back to 0 accepted.
    stdin.write(CTRL_Z);
    await tick();
    const afterUndo = lastFrame() ?? '';
    // Redo → 1 accepted again.
    stdin.write(CTRL_Y);
    await tick();
    const afterRedo = lastFrame() ?? '';
    expect(afterUndo).not.toBe(afterRedo);
  });
});
