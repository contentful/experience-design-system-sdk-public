import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the DB layer BEFORE importing GenerateReviewStep ─────────────────────

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
  loadCDFComponents: vi.fn().mockReturnValue([{ key: 'Button', entry: SAMPLE_ENTRY }]),
  storeCDFComponents: vi.fn(),
}));

let GenerateReviewStep: typeof import('../../../../src/import/tui/steps/GenerateReviewStep.js').GenerateReviewStep;

beforeEach(async () => {
  const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
  GenerateReviewStep = mod.GenerateReviewStep;
});

afterEach(() => {
  vi.clearAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

describe('GenerateReviewStep — form by default (Fix 1)', () => {
  it('mounts with FieldEditor (form) visible — not the JSON panel', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // FieldEditor renders a 'FIELDS' header
    expect(frame).toMatch(/FIELDS/);
    // JsonPanel header (read-only) should NOT be present initially
    expect(frame).not.toMatch(/GENERATED DEFINITION \(read-only\)/);
  });

  it('hint excludes [e] edit (no longer needed — form is the editor)', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/\[e\] edit/);
  });

  it('pressing J toggles read-only JSON view; pressing J again returns to form', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Sidebar focused by default — J toggles JSON view.
    stdin.write('J');
    await tick();
    const jsonFrame = lastFrame() ?? '';
    expect(jsonFrame).toMatch(/GENERATED DEFINITION \(read-only\)/);
    // Should NOT show FieldEditor header anymore
    expect(jsonFrame).not.toMatch(/FIELDS \[Ctrl\+S/);

    // Press J again — back to form
    stdin.write('J');
    await tick();
    const backFrame = lastFrame() ?? '';
    expect(backFrame).toMatch(/FIELDS/);
    expect(backFrame).not.toMatch(/GENERATED DEFINITION \(read-only\)/);
  });

  it('hint shows "show JSON" / "hide JSON" labels reflecting the toggle', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[J\] show JSON/);

    stdin.write('J');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[J\] hide JSON/);
  });
});

describe('GenerateReviewStep — sidebar↔panel cross-key (Bug 1)', () => {
  it('initial hint shows [e/Tab] focus panel when sidebar is focused', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
  });

  it('pressing e from sidebar crosses focus to the panel', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('e');
    await tick();
    const frame = lastFrame() ?? '';
    // After crossing, the bottom hint reflects panel-focused state.
    // `e` is sidebar-only now, so the panel-focused hint advertises Tab only.
    expect(frame).toMatch(/\[Tab\] focus list/);
  });

  it('Tab still works as an alias to cross focus', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
  });

  it('pressing e while panel is focused does NOT cross back to sidebar (gated)', async () => {
    // `e` is gated to sidebar-focused state to avoid colliding with
    // FieldEditor's enum-values `e` binding (INTEG-4254). Crossing back
    // is Tab-only.
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Cross into panel via Tab.
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    // Now press `e` — should fall through to FieldEditor, NOT toggle focus
    // back to sidebar. Hint should still indicate panel-focused.
    stdin.write('e');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    expect(frame).not.toMatch(/\[e\/Tab\] focus panel/);
  });

  it('pressing Esc at FieldEditor row-level returns focus to the sidebar', async () => {
    // Bug 1 fix: Esc inside the panel at row-level should call onExit which
    // bounces focus back to the sidebar. This is the primary panel→sidebar
    // exit affordance (alongside Tab and Ctrl+S).
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Cross into panel.
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    // FieldEditor mounts at row-level. Esc should fire onExit → sidebar.
    stdin.write('\x1b');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
  });
});
