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
      '$token.allowed': ['colors.surface.default', 'colors.surface.raised'],
    },
    borderColor: {
      $type: 'token' as const,
      $category: 'design' as const,
      '$token.kind': 'color',
      '$token.allowed': ['colors.border.subtle', 'colors.border.strong'],
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
  loadDTCGTokens: vi.fn((_db: unknown, sessionId: string) => ({
    groups: [],
    tokens: [
      { path: 'colors.surface.default', $type: 'color', $value: '#fff' },
      { path: 'colors.surface.raised', $type: 'color', $value: '#eee' },
      { path: 'colors.brand.primary', $type: 'color', $value: '#00f' },
      ...(sessionId === 'token-session'
        ? [{ path: 'colors.brand.secondary', $type: 'color', $value: '#0f0' }]
        : []),
      { path: 'spacing.small', $type: 'dimension', $value: '4px' },
    ],
  })),
  storeCDFComponents: vi.fn(),
  loadComponentReviewMetadata: vi.fn().mockReturnValue({
    sourcePath: '/repo/src/Button.tsx',
    componentSource: 'export const Button = () => <button/>;\nconst x = 1;\n',
  }),
  loadComponentRationale: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/apply/manifest.js', () => ({
  readTokensFromPath: vi.fn().mockResolvedValue([
    { path: 'colors.file.only', $type: 'color', $value: '#0f0' },
    { path: 'radius.file.small', $type: 'dimension', $value: '2px' },
    { path: 'radius.file.large', $type: 'dimension', $value: '8px' },
    { path: 'spacing.file.only', $type: 'dimension', $value: '8px' },
  ]),
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

function renderStep(tokenSessionId?: string) {
  return render(
    <AtomicGenerateReviewStep
      extractSessionId="s1"
      {...(tokenSessionId ? { tokenSessionId } : {})}
      onFinalize={() => {}}
      onQuit={() => {}}
      livePreview={false}
    />,
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

describe('AtomicGenerateReviewStep — token review editing', () => {
  it('shows and opens token review after Tab focuses the prop list', async () => {
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\t');
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[t\] token review/);
    stdin.write('t');
    await tick();
    expect(lastFrame() ?? '').toMatch(/TOKEN REVIEW —/i);
  });

  it('edits all compatible tokens, persists a non-empty subset, and keeps suggested unchanged', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('\r');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toContain('colors.brand.primary');
    expect(frame).not.toContain('spacing.small');
    stdin.write('j');
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write('k');
    await tick();
    stdin.write(' ');
    await tick();
    stdin.write('\x13');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toContain('suggested: colors.surface.default, colors.surface.raised');
    expect(frame).toContain('allowed: colors.surface.default');
    const lastCall = vi.mocked(dbModule.storeCDFComponents).mock.calls.at(-1);
    expect(lastCall![2][0].entry.$properties.bgColor['$token.allowed']).toEqual(['colors.surface.default']);
  });

  it('loads the full compatible catalog from tokenSessionId', async () => {
    const { stdin, lastFrame } = renderStep('token-session');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('colors.brand.secondary');
    expect(frame).not.toContain('spacing.small');
  });

  it('loads the full compatible catalog from tokensPath when reusing existing tokens', async () => {
    const { stdin, lastFrame } = render(
      <AtomicGenerateReviewStep
        extractSessionId="s1"
        tokensPath="/project/.contentful/tokens.json"
        onFinalize={() => {}}
        onQuit={() => {}}
        livePreview={false}
      />,
    );
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('colors.file.only');
    expect(frame).not.toContain('spacing.file.only');
  });

  it('prefers the complete tokensPath catalog over the token session', async () => {
    const { stdin, lastFrame } = render(
      <AtomicGenerateReviewStep
        extractSessionId="s1"
        tokenSessionId="token-session"
        tokensPath="/project/.contentful/tokens.json"
        onFinalize={() => {}}
        onQuit={() => {}}
        livePreview={false}
      />,
    );
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('colors.file.only');
    expect(frame).not.toContain('colors.brand.secondary');
  });

  it('does not accept or dismiss when those legacy keys are pressed', async () => {
    const dbModule = await import('../../../../src/session/db.js');
    const { stdin, lastFrame } = renderStep();
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('t');
    await tick();
    const callsBefore = vi.mocked(dbModule.storeCDFComponents).mock.calls.length;
    stdin.write('a');
    stdin.write('x');
    await tick();
    expect(vi.mocked(dbModule.storeCDFComponents).mock.calls.length).toBe(callsBefore);
    expect(lastFrame() ?? '').toContain('bgColor');
  });
});
