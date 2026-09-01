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

describe('AtomicGenerateReviewStep — hide state/unattached props from JSON panel by default (Task 4)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;

  const CATEGORIZED_ENTRY: Entry = {
    $type: 'component',
    $properties: {
      label: { $type: 'string', $category: 'content' },
      variant: { $type: 'enum', $category: 'design', $values: ['primary', 'secondary'] },
      isDisabled: { $type: 'boolean', $category: 'state' },
      className: { $type: 'string', $category: 'unattached', $required: false },
    },
  };

  it('hides state and unattached props from the JSON panel by default, and reveals them on H', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Button', entry: CATEGORIZED_ENTRY }]);
    const { lastFrame, stdin } = renderStep();
    await tick();
    stdin.write('J');
    await tick();

    const defaultFrame = lastFrame() ?? '';
    expect(defaultFrame).toMatch(/GENERATED DEFINITION \(read-only\)/);
    expect(defaultFrame).toMatch(/label/);
    expect(defaultFrame).toMatch(/variant/);
    expect(defaultFrame).not.toMatch(/isDisabled/);
    expect(defaultFrame).not.toMatch(/className/);

    stdin.write('H');
    await tick();

    const revealedFrame = lastFrame() ?? '';
    expect(revealedFrame).toMatch(/label/);
    expect(revealedFrame).toMatch(/variant/);
    expect(revealedFrame).toMatch(/isDisabled/);
    expect(revealedFrame).toMatch(/className/);
  });

  it('footer legend shows "show state/unattached" / "hide state/unattached" labels reflecting the H toggle', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Button', entry: CATEGORIZED_ENTRY }]);
    const { lastFrame, stdin } = renderStep();
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[H\] show state\/unattached/);

    stdin.write('H');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[H\] hide state\/unattached/);
  });
});
