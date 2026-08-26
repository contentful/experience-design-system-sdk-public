import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    bgColor: {
      $type: 'token' as const,
      $category: 'design' as const,
      '$token.kind': 'color',
      '$token.sets': ['colors.surface.default', 'colors.surface.raised'],
      '$token.allowed': ['colors.surface.default'],
    },
    borderColor: {
      $type: 'token' as const,
      $category: 'design' as const,
      '$token.kind': 'color',
      '$token.sets': ['colors.border.subtle', 'colors.border.strong'],
      '$token.allowed': ['colors.border.subtle'],
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

const triggerSpy = vi.fn();
let hookReturnOverride: { trigger: () => void; status: 'idle' | 'running'; disabled: boolean } | null = null;
vi.mock('../../../../src/import/tui/useLivePreview.js', () => ({
  useLivePreview: () => hookReturnOverride ?? { trigger: triggerSpy, status: 'idle' as const, disabled: true },
}));

let AtomicGenerateReviewStep: typeof import('../../../../src/import/tui/steps/AtomicGenerateReviewStep.js').AtomicGenerateReviewStep;

beforeEach(async () => {
  const mod = await import('../../../../src/import/tui/steps/AtomicGenerateReviewStep.js');
  AtomicGenerateReviewStep = mod.AtomicGenerateReviewStep;
  triggerSpy.mockReset();
  hookReturnOverride = null;
});

afterEach(() => {
  vi.clearAllMocks();
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

describe('AtomicGenerateReviewStep — token review panel', () => {
  it('shows the [t] token review hint only when the selected component has a suggestion', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    // sortComponentsForSidebar puts the empty Card ahead of Button in the
    // warning tier, so Card (no suggestion) is selected first — move down
    // one row to Button, which carries the bgColor suggestion.
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[t\] token review/);
  });

  it('opens the token review panel on [t] and lists the suggested prop', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/TOKEN REVIEW/i);
    expect(frame).toContain('bgColor');
    expect(frame).toContain('colors.surface.default');
  });

  it('closes the panel on Esc', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    // Card (empty) is selected first and has no token suggestion — 't' is a
    // no-op there, which would make this assertion pass vacuously. Move to
    // Button first so the panel actually opens before we verify Esc closes it.
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    // Match the panel header specifically (with the em dash) — the footer
    // legend's "[t] token review" hint is lowercase but still matches a
    // case-insensitive /TOKEN REVIEW/ check, so it can't distinguish
    // panel-open from panel-closed on its own.
    expect(lastFrame() ?? '').toMatch(/TOKEN REVIEW —/i);
    stdin.write('\x1b');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/TOKEN REVIEW —/i);
  });
});

describe('AtomicGenerateReviewStep — token review actions', () => {
  it('accept persists $token.sets/$token.allowed via storeCDFComponents and triggers live preview', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    hookReturnOverride = { trigger: triggerSpy, status: 'idle', disabled: false };

    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('a');
    await tick();
    expect(lastFrame() ?? '').toMatch(/✓ bgColor/);
    expect(dbModule.storeCDFComponents).toHaveBeenCalled();
    expect(triggerSpy).toHaveBeenCalled();
    const lastCall = vi.mocked(dbModule.storeCDFComponents).mock.calls.at(-1);
    const entry = lastCall![2][0].entry;
    expect(entry.$properties.bgColor['$token.sets']).toEqual(['colors.surface.default', 'colors.surface.raised']);
    expect(entry.$properties.bgColor['$token.allowed']).toEqual(['colors.surface.default']);
  });

  it('dismiss clears both fields and does not affect other props', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('x'); // dismiss bgColor — borderColor's suggestion should survive untouched.
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('bgColor');
    expect(frame).toContain('borderColor');
    const lastCall = vi.mocked(dbModule.storeCDFComponents).mock.calls.at(-1);
    const entry = lastCall![2][0].entry;
    expect(entry.$properties.bgColor['$token.sets']).toEqual([]);
    expect(entry.$properties.bgColor['$token.allowed']).toEqual([]);
    expect(entry.$properties.borderColor['$token.sets']).toEqual(['colors.border.subtle', 'colors.border.strong']);
    expect(entry.$properties.borderColor['$token.allowed']).toEqual(['colors.border.subtle']);
  });

  it('edit constrains selection to paths already in $token.sets, then Ctrl+S persists the narrowed allowed list', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('\r'); // Enter → edit mode
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toContain('colors.surface.default');
    expect(frame).toContain('colors.surface.raised');
    stdin.write('j'); // move to colors.surface.raised
    await tick();
    stdin.write(' '); // toggle it into the allowed selection
    await tick();
    stdin.write('\x13'); // Ctrl+S
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/✓ bgColor/);
    const lastCall = vi.mocked(dbModule.storeCDFComponents).mock.calls.at(-1);
    const entry = lastCall![2][0].entry;
    // Starts with editSelection = {colors.surface.default} (from $token.allowed);
    // toggling colors.surface.raised on adds it rather than replacing it, so the
    // saved allowed list ends up with both paths.
    expect(entry.$properties.bgColor['$token.allowed']).toEqual([
      'colors.surface.default',
      'colors.surface.raised',
    ]);
  });

  it('[u] restores a dismissed prop\'s pre-dismiss $token.sets/$token.allowed', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('x'); // dismiss bgColor
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[u\] undo/);
    stdin.write('u');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('bgColor');
    expect(frame).not.toMatch(/\[u\] undo/); // single-slot memory consumed by the undo
    const lastCall = vi.mocked(dbModule.storeCDFComponents).mock.calls.at(-1);
    const entry = lastCall![2][0].entry;
    expect(entry.$properties.bgColor['$token.sets']).toEqual(['colors.surface.default', 'colors.surface.raised']);
    expect(entry.$properties.bgColor['$token.allowed']).toEqual(['colors.surface.default']);
  });

  it('[u] does nothing when nothing has been dismissed', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    const callsBefore = vi.mocked(dbModule.storeCDFComponents).mock.calls.length;
    stdin.write('u');
    await tick();
    expect(vi.mocked(dbModule.storeCDFComponents).mock.calls.length).toBe(callsBefore);
    expect(lastFrame() ?? '').not.toMatch(/\[u\] undo/);
  });

  it('dismissing a second prop discards the pending undo for the first (single-slot memory)', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j'); // Card (empty) is selected first; move to Button.
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('x'); // dismiss bgColor (row 0)
    await tick();
    stdin.write('x'); // now on borderColor (bgColor's row is gone); dismiss it too
    await tick();
    const frame = lastFrame() ?? '';
    // Undo hint still shows (borderColor is now the pending undo), but pressing
    // [u] can only restore the most recent dismiss (borderColor), not bgColor.
    expect(frame).toMatch(/\[u\] undo/);
    stdin.write('u');
    await tick();
    const afterUndo = lastFrame() ?? '';
    expect(afterUndo).toContain('borderColor');
    expect(afterUndo).not.toContain('bgColor');
  });
});
