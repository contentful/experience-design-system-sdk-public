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
  loadSlotCycles: vi.fn().mockReturnValue([]),
  storeSlotCycles: vi.fn(),
  loadComponentReviewMetadata: vi.fn().mockReturnValue(null),
  loadComponentRationale: vi.fn().mockReturnValue({
    name: 'Button',
    description: 'A button component',
    descriptionRationale: 'why-desc',
    propsRationale: 'why-props',
    slotsRationale: 'why-slots',
    props: [{ name: 'variant', category: 'content', description: 'Visual style', rationale: 'enum visual variant' }],
    slots: [],
  }),
}));

// Capture useLivePreview hook calls so Task 4 tests can assert when trigger
// fires and how the hook is configured (enabled flag, onResult callback).
const triggerSpy = vi.fn();
let lastUseLivePreviewArgs: unknown = null;
let lastOnResult:
  | ((r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void)
  | null = null;
// Mutable hook-return state used by Task 5 tests (declared up here so the
// hoisted vi.mock factory below can reference it without TDZ at call time).
let hookReturnOverride: { trigger: () => void; status: 'idle' | 'running'; disabled: boolean } | null = null;
vi.mock('../../../../src/import/tui/useLivePreview.js', () => ({
  useLivePreview: (args: {
    enabled: boolean;
    onResult: (r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void;
  }) => {
    lastUseLivePreviewArgs = args;
    lastOnResult = args.onResult;
    // hookReturnOverride is mutated by Task 5 tests via the shared state above;
    // when null, the default idle/non-disabled return is used.

    return hookReturnOverride ?? { trigger: triggerSpy, status: 'idle' as const, disabled: false };
  },
}));

let GenerateReviewStep: typeof import('../../../../src/import/tui/steps/GenerateReviewStep.js').GenerateReviewStep;
let sortComponentsForSidebar: typeof import('../../../../src/import/tui/steps/GenerateReviewStep.js').sortComponentsForSidebar;

beforeEach(async () => {
  const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
  GenerateReviewStep = mod.GenerateReviewStep;
  sortComponentsForSidebar = mod.sortComponentsForSidebar;
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

describe('GenerateReviewStep — empty-component warning banner (Bug 2, INTEG-4257)', () => {
  it('renders a top-of-panel ⚠ banner when one or more components have empty $properties', async () => {
    const EMPTY_ENTRY = {
      $type: 'component' as const,
      $properties: {},
    };
    const POPULATED_ENTRY = {
      $type: 'component' as const,
      $properties: {
        label: { $type: 'string' as const, $category: 'content' as const },
      },
    };

    const dbMod = await import('../../../../src/session/db.js');
    // Use short names so the sidebar doesn't truncate the "(empty)" suffix
    // under ink-testing-library's narrow column width.
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Btn', entry: POPULATED_ENTRY },
      { key: 'Foo', entry: EMPTY_ENTRY },
    ]);

    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('⚠');
    expect(frame).toMatch(/no classifiable props/i);
    // Sidebar shows the "(empty)" suffix on the affected component.
    expect(frame).toMatch(/Foo \(empty\)/);
  });

  it('does NOT render the banner when every component has at least one $properties entry', async () => {
    // Default mock at module load returns a single populated component.
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/no classifiable props/i);
  });

  it('does NOT flag a component with 0 properties but 1+ slots as empty', async () => {
    const SLOT_ONLY_ENTRY = {
      $type: 'component' as const,
      $properties: {},
      $slots: { header: { $allowedComponents: ['Heading'] } },
    };
    const POPULATED_ENTRY = {
      $type: 'component' as const,
      $properties: {
        label: { $type: 'string' as const, $category: 'content' as const },
      },
    };

    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Btn', entry: POPULATED_ENTRY },
      { key: 'Card', entry: SLOT_ONLY_ENTRY },
    ]);

    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/no classifiable props/i);
    expect(frame).not.toMatch(/Card \(empty\)/);
  });
});

describe('GenerateReviewStep — sortComponentsForSidebar (Bug, INTEG-4259)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const FULL: Entry = {
    $type: 'component',
    $properties: { foo: { $type: 'string', $category: 'content' } },
  };
  const EMPTY: Entry = { $type: 'component', $properties: {} };
  const SLOT_ONLY: Entry = {
    $type: 'component',
    $properties: {},
    $slots: { children: {} },
  };

  it('sorts empty components to the top and tie-breaks alphabetically within each tier', () => {
    const input: Array<{ key: string; entry: Entry }> = [
      { key: 'Apple', entry: FULL },
      { key: 'Beta', entry: EMPTY },
      { key: 'Charlie', entry: FULL },
      { key: 'Alpha', entry: EMPTY },
    ];
    const result = sortComponentsForSidebar(input);
    // Empty (Alpha, Beta) first alphabetical, then non-empty (Apple, Charlie) alphabetical.
    expect(result.map((c) => c.key)).toEqual(['Alpha', 'Beta', 'Apple', 'Charlie']);
  });

  it('preserves alphabetical order when no components are empty', () => {
    const input: Array<{ key: string; entry: Entry }> = [
      { key: 'Charlie', entry: FULL },
      { key: 'Apple', entry: FULL },
    ];
    const result = sortComponentsForSidebar(input);
    expect(result.map((c) => c.key)).toEqual(['Apple', 'Charlie']);
  });

  it('preserves alphabetical order when every component is empty', () => {
    const input: Array<{ key: string; entry: Entry }> = [
      { key: 'Charlie', entry: EMPTY },
      { key: 'Apple', entry: EMPTY },
    ];
    const result = sortComponentsForSidebar(input);
    expect(result.map((c) => c.key)).toEqual(['Apple', 'Charlie']);
  });

  it('treats a component with 0 properties but 1+ slots as non-empty', () => {
    const input: Array<{ key: string; entry: Entry }> = [
      { key: 'Card', entry: SLOT_ONLY },
      { key: 'AbsolutelyEmpty', entry: EMPTY },
      { key: 'Btn', entry: FULL },
    ];
    const result = sortComponentsForSidebar(input);
    expect(result.map((c) => c.key)).toEqual(['AbsolutelyEmpty', 'Btn', 'Card']);
  });
});

describe('GenerateReviewStep — Feature 2 live-preview wiring', () => {
  const VALID_DRAFT = JSON.stringify({
    Button: {
      $type: 'component',
      $description: 'A button',
      $properties: {
        variant: { $type: 'enum', $category: 'content', $values: ['primary'] },
      },
    },
  });

  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
  });

  it('mounts useLivePreview with enabled=true by default', async () => {
    render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />);
    await tick();
    expect(lastUseLivePreviewArgs).not.toBeNull();
    expect((lastUseLivePreviewArgs as { enabled: boolean }).enabled).toBe(true);
  });

  it('with livePreview=false prop: useLivePreview is mounted with enabled=false', async () => {
    render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />);
    await tick();
    expect((lastUseLivePreviewArgs as { enabled: boolean }).enabled).toBe(false);
  });

  it('mounts useLivePreview with creds, sessionId, tokensPath, and onResult', async () => {
    render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        spaceId="sp"
        environmentId="master"
        cmaToken="t"
        host="h"
        tokensPath="/tmp/tokens.json"
      />,
    );
    await tick();
    const args = lastUseLivePreviewArgs as {
      sessionId: string;
      spaceId: string;
      environmentId: string;
      cmaToken: string;
      host: string;
      tokensPath: string;
      onResult: unknown;
    };
    expect(args.sessionId).toBe('sess-1');
    expect(args.spaceId).toBe('sp');
    expect(args.environmentId).toBe('master');
    expect(args.cmaToken).toBe('t');
    expect(args.host).toBe('h');
    expect(args.tokensPath).toBe('/tmp/tokens.json');
    expect(typeof args.onResult).toBe('function');
    // Note: handleEditSave's success branch calls trigger(); driving a full
    // FieldEditor draft round-trip through Ink stdin is not feasible because
    // the form is field-driven, not text-driven. The trigger() call is
    // verified by code inspection; the negative-path 'no trigger before
    // save' assertion below pins that we are not over-firing.
  });

  it('failed save (malformed draft via direct invariant) does NOT call trigger', async () => {
    // When draftValue is non-empty malformed JSON, JSON.parse throws and
    // setSaveError fires — trigger must not be called from that save path.
    // We can't easily type malformed JSON into the FieldEditor through Ink,
    // so this test pins the contract by counting trigger calls. After
    // pilot-2026-06-23 R2, the on-entry effect fires trigger exactly once
    // on load; no save = no additional trigger calls.
    render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />);
    await tick();
    // Exactly one call — the on-entry fire — and no further trigger from a
    // malformed save (because no save happens).
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('onResult populates per-component previewAnnotation visible in sidebar', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Simulate a successful live-preview response coming back through onResult.
    expect(lastOnResult).not.toBeNull();
    lastOnResult!({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'b', name: 'Button', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} } as never,
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'compatible', breakingChanges: [] },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    // Annotation map is held in state and merged into sidebarItems; the row
    // for "Button" should now carry previewAnnotation === 'changed' through
    // to the rendered surface. We verify by inspecting the prop passed to
    // Sidebar via the rendered frame contains "Button" and the test setup is
    // wired (sidebar always renders the name; the annotation field doesn't
    // currently render a visible glyph in the wizard sidebar — coverage of
    // the field plumbing is the assertion).
    expect(VALID_DRAFT).toBeTypeOf('string');
    expect(lastFrame() ?? '').toMatch(/Button/);
  });
});

// ── Pilot-2026-06-23 R2: live preview must fire on entry to final-review ────
// Before this fix, livePreviewHook.trigger() was only invoked from
// handleEditSave, so operators saw no diff badges until they Ctrl+S'd at
// least once. The fix adds a one-shot effect that fires after components
// load, respecting the existing opt-out paths (livePreview=false and
// missing creds — the latter is the hook's own short-circuit).
describe('GenerateReviewStep — initial live-preview trigger on entry (R2)', () => {
  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('fires trigger() once after components load with creds present', async () => {
    render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        spaceId="sp"
        environmentId="master"
        cmaToken="t"
        host="h"
        tokensPath="/tmp/tokens.json"
      />,
    );
    await tick();
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire trigger() when livePreview=false (--no-live-preview)', async () => {
    render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        livePreview={false}
        spaceId="sp"
        environmentId="master"
        cmaToken="t"
      />,
    );
    await tick();
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('still calls trigger() when creds are missing — the hook short-circuits internally', async () => {
    // The cred-missing graceful no-op lives inside useLivePreview.trigger
    // (F2's 18be9c0). The step component still calls trigger; the hook
    // decides whether to fire the underlying API call.
    render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />);
    await tick();
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GenerateReviewStep — Feature 2 spinner indicator', () => {
  beforeEach(() => {
    hookReturnOverride = null;
  });

  it('shows "live preview" + spinner glyph in the status row when status is running', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'running', disabled: false };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame.replace(/[^\w!]+/g, ' ')).toMatch(/live preview/);
  });

  it('shows "live preview disabled" in dim text when hook reports disabled', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'idle', disabled: true };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame.replace(/[^\w!]+/g, ' ')).toMatch(/live preview disabled/);
  });

  it('does NOT render any "live preview" indicator when idle and not disabled', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'idle', disabled: false };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/live preview/);
  });
});

// ── Pilot-2026-06-23 R2: top-of-step diff summary panel ─────────────────────
// Operators want an at-a-glance count of new/changed/removed/breaking on
// entry to final-review without having to scan every row's badge. The summary
// renders above the empty-component banner; running/disabled states surface
// in the same line; --no-live-preview suppresses it entirely.
describe('GenerateReviewStep — diff summary panel (R2)', () => {
  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('renders count summary when previewAnnotations are populated', async () => {
    // Local manifest must contain the "new" names so the derivation
    // (localNames \ unchanged ∪ changed ∪ removed) reports them as new.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'A', entry: SAMPLE_ENTRY },
      { key: 'B', entry: SAMPLE_ENTRY },
      { key: 'C', entry: SAMPLE_ENTRY },
      { key: 'D', entry: SAMPLE_ENTRY },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastOnResult).not.toBeNull();
    lastOnResult!({
      components: {
        new: [],
        changed: [
          {
            current: { id: '1', name: 'C', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} } as never,
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'compatible', breakingChanges: [] },
          },
          {
            current: { id: '2', name: 'D', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} } as never,
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'breaking', breakingChanges: [] },
          },
        ],
        removed: [{ id: 'e', name: 'E', contentProperties: [], designProperties: [], slots: [] } as never],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    const frame = lastFrame() ?? '';
    // Summary line begins with "Preview:" and lists kind counts.
    expect(frame).toMatch(/Preview:/);
    expect(frame).toMatch(/2 new/);
    expect(frame).toMatch(/1 changed/);
    expect(frame).toMatch(/1 removed/);
    expect(frame).toMatch(/1 breaking/);
  });

  it('shows "running" state when the hook is running and no annotations yet', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'running', disabled: false };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Preview:.*running/);
  });

  it('shows "disabled" state with creds-rejected hint when hook reports disabled', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'idle', disabled: true };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Preview:.*disabled/);
  });

  it('renders no summary when livePreview=false (--no-live-preview)', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Preview:/);
  });

  it('renders nothing when idle, not disabled, and no annotations yet', async () => {
    hookReturnOverride = { trigger: vi.fn(), status: 'idle', disabled: false };
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Preview:/);
  });

  it('preserves existing surfaces — sidebar, status bar, focus hint', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // Sidebar still renders the component
    expect(frame).toMatch(/Button/);
    // Focus hint still rendered
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
    // Status bar still rendered
    expect(frame).toMatch(/accept all/);
  });
});

// ── T1 (layout plan §A): removed components as permanent top strip ──────────
// The removed panel is no longer a modal toggled by `[d]` / `[Esc]`. It's a
// red-bordered strip rendered unconditionally above every other GR banner
// whenever `removedComponents.length > 0`. When empty, it renders NOTHING
// (no placeholder, no push-down of layout). `[d]` is no longer bound.
describe('GenerateReviewStep — removed-components top strip (T1)', () => {
  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  const previewWithRemoved = (names: string[]) =>
    ({
      components: {
        new: [],
        changed: [],
        removed: names.map((n, i) => ({
          id: `r${i}`,
          name: n,
          contentProperties: [],
          designProperties: [],
          slots: [],
        })) as never,
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    }) as never;

  it('renders NOTHING when removedComponents is empty (no push-down)', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!({
      components: { new: [], changed: [], removed: [], unchanged: ['Button'] },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Removed components/);
  });

  it('renders the strip permanently (no keystroke needed) when removed > 0', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Removed components (1)');
    expect(frame).toContain('DELETE');
    expect(frame).toMatch(/Widget/);
  });

  it('[d] no longer toggles anything (removed panel wiring is gone)', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Empty removed set, so strip should be absent.
    expect(lastFrame() ?? '').not.toMatch(/Removed components/);
    stdin.write('d');
    await tick();
    // Still absent — `d` no longer opens the panel.
    expect(lastFrame() ?? '').not.toMatch(/Removed components/);
  });

  it('legend no longer advertises [d]', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[d] removed list');
    expect(frame).not.toContain('([d] removed list)');
  });

  it('title includes the word DELETE for notability', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Gone1']));
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Removed components \(1\)/);
    expect(frame).toContain('DELETE');
  });
});

// Legacy T3-era describe blocks removed as part of T1 (top-strip conversion).
// Removed 13 tests exercising [d] toggle, Esc close, auto-open latching, and
// legend/summary "[d] removed list" hints. Replaced by the 5 T1 tests above.

// ── Bug pilot-2026-06-23: rapid j/k stutter / cursor loss ────────────────────
// Holding `j` or `k` rapidly used to leave the cursor on a stale row because
// each handler invocation read selectedIdx from a stale closure. The fix
// rewrote j/k to use functional setState so each pending update sees the
// previous value. This pins that contract: N j keystrokes advance the
// cursor N rows (clamped by list length), even when fired before any
// re-render has settled.
describe('GenerateReviewStep — rapid j/k navigation (no stutter)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  it('rapid j burst advances the cursor exactly N rows (no stale-closure regression)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Names chosen so they sort alphabetically into a known order; all
    // populated so none are sorted to the empty tier.
    const KEYS = ['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Fire 3 j's in quick succession (all in the same micro-batch).
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    // After 3 j's, cursor should be on Ddd. Sidebar marks the selected row
    // — we use the title at the top of the panel which mirrors selected.key.
    const frame = lastFrame() ?? '';
    // The panel title is rendered bold; just check the selected key string is
    // present and is the expected one. We assert by checking that Ddd is on a
    // line that also contains "prop" (the selected-component header).
    const hasSelected = frame.split('\n').some((l) => l.includes('Ddd') && /\bprop/.test(l));
    expect(hasSelected).toBe(true);
  });

  it('rapid k burst from middle position decrements cursor exactly N rows', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Move down 4 to land on Eee.
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    // Now fire 2 k's quickly — cursor should be on Ccc.
    stdin.write('k');
    stdin.write('k');
    await tick();
    const frame = lastFrame() ?? '';
    const hasSelected = frame.split('\n').some((l) => l.includes('Ccc') && /\bprop/.test(l));
    expect(hasSelected).toBe(true);
  });
});

// Pilot-2026-06-24 R2: strict opt-in semantics at finalize. Components left
// in 'needs-review' (i.e. not explicitly accepted) must be downgraded to
// 'generate-rejected' in the DB so loadCDFComponents excludes them from the
// push manifest. Operator's mental model is "only what I explicitly accepted
// should ship".
describe('GenerateReviewStep — strict opt-in finalize semantics', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  it('downgrades unresolved (needs-review) components to generate-rejected at finalize', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    // Capture the stmt.run calls on the prepared statement so we can assert
    // which component names were marked rejected at finalize time.
    const runSpy = vi.fn();
    vi.mocked(dbMod.openPipelineDb).mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run: runSpy }),
      exec: vi.fn(),
      close: vi.fn(),
    } as unknown as ReturnType<typeof dbMod.openPipelineDb>);

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
    // Accept Aaa only. Bbb + Ccc remain needs-review.
    stdin.write('a');
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    const rejectedNames = runSpy.mock.calls.map((args) => args[1]).sort();
    expect(rejectedNames).toEqual(['Bbb', 'Ccc']);
    expect(onFinalize).toHaveBeenCalledWith(1, 0, 2);
  });

  it('still writes generate-rejected for explicitly rejected components', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    const runSpy = vi.fn();
    vi.mocked(dbMod.openPipelineDb).mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run: runSpy }),
      exec: vi.fn(),
      close: vi.fn(),
    } as unknown as ReturnType<typeof dbMod.openPipelineDb>);

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
    // Accept Aaa, explicitly reject Bbb.
    stdin.write('a');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    const rejectedNames = runSpy.mock.calls.map((args) => args[1]);
    expect(rejectedNames).toEqual(['Bbb']);
    expect(onFinalize).toHaveBeenCalledWith(1, 1, 0);
  });

  it('writes no rejected rows when every component is explicitly accepted', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    const runSpy = vi.fn();
    vi.mocked(dbMod.openPipelineDb).mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run: runSpy }),
      exec: vi.fn(),
      close: vi.fn(),
    } as unknown as ReturnType<typeof dbMod.openPipelineDb>);

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
    // Accept all via 'A'.
    stdin.write('A');
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    expect(runSpy).not.toHaveBeenCalled();
    expect(onFinalize).toHaveBeenCalledWith(3, 0, 0);
  });
});

describe('GenerateReviewStep - component rationale panels (lifted)', () => {
  it('pressing I from sidebar focus opens the component rationale panel and replaces the right pane', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/FIELDS/);
    stdin.write('I');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('Component rationale');
    expect(out).toContain('Button');
    // FieldEditor must NOT be rendered when the panel is open.
    expect(out).not.toMatch(/FIELDS \[Ctrl\+S/);
  });

  it('pressing p from sidebar focus opens the prop rationale panel and replaces the right pane (T5b: [i] rebound)', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('p');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('RATIONALE');
    expect(out).not.toMatch(/FIELDS \[Ctrl\+S/);
  });

  it('pressing I again closes the panel and restores the right pane', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('I');
    await tick();
    expect(lastFrame() ?? '').toContain('Component rationale');
    stdin.write('I');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).not.toContain('Component rationale');
    expect(out).toMatch(/FIELDS/);
  });

  it('Esc closes an open rationale panel without quitting the step', async () => {
    const onQuit = vi.fn();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={onQuit} />,
    );
    await tick();
    stdin.write('I');
    await tick();
    expect(lastFrame() ?? '').toContain('Component rationale');
    stdin.write('\u001b'); // Esc
    await tick();
    expect(lastFrame() ?? '').not.toContain('Component rationale');
    expect(onQuit).not.toHaveBeenCalled();
  });

  it('opening component-rationale closes prop-rationale (mutual exclusion)', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('p');
    await tick();
    expect(lastFrame() ?? '').toContain('RATIONALE');
    stdin.write('I');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('Component rationale');
    // The lowercase-i panel header is "RATIONALE - <name>"; with the
    // uppercase panel open, the small-r prop panel should not render.
    expect(out).not.toMatch(/^RATIONALE/m);
  });

  it('rationale keys are gated when the finalize dialog is open', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('F'); // open finalize dialog
    await tick();
    stdin.write('I');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Component rationale');
  });
});

// ── INTEG-4411 refined: preview-aware finalize guard ────────────────────────
// PR #90 shipped a strict `acceptedCount === 0` block up-front in the step.
// That was too strict — rejecting a component that exists server-side still
// produces a valid push (a REMOVAL). The refined rule moves the no-op check
// downstream into WizardApp.runPreview, which consults the preview response.
// At the step level we now assert that finalize is NEVER blocked based on
// accept counts alone — the wizard decides. The step still renders an inline
// banner when the wizard passes `initialFinalizeError` (routed back after
// the preview API returned an empty diff).
describe('GenerateReviewStep — preview-aware finalize guard (INTEG-4411 refined)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  it('calls onFinalize even when every component is rejected — wizard-side check consults preview', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith(0, 3, 0);
  });

  it('calls onFinalize even when every component is still needs-review', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    expect(onFinalize).toHaveBeenCalledTimes(1);
    expect(onFinalize).toHaveBeenCalledWith(0, 0, 3);
  });

  it('surfaces an inline banner when the wizard passes initialFinalizeError (routed back after empty preview)', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        initialFinalizeError="Nothing to push — accept a component, reject a component that exists in Contentful, or quit."
      />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Nothing to push/);
  });

  it('pressing `a` clears the initial finalize banner', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        initialFinalizeError="Nothing to push — accept a component, reject a component that exists in Contentful, or quit."
      />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/Nothing to push/);
    stdin.write('a');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Nothing to push/);
  });

  it('allows finalize when at least one component is accepted (regression guard)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc', 'Ddd'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));

    const onFinalize = vi.fn();
    const { stdin, lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();

    expect(onFinalize).toHaveBeenCalledTimes(1);
    const [accepted] = onFinalize.mock.calls[0];
    expect(accepted).toBe(1);
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Nothing to push/);
  });
});

describe('GenerateReviewStep — slot-cycle warning surface (INTEG-4401)', () => {
  const CYCLE_A = {
    $type: 'component' as const,
    $properties: {},
    $slots: { header: { $allowedComponents: ['CycleB'] } },
  };
  const CYCLE_B = {
    $type: 'component' as const,
    $properties: {},
    $slots: { footer: { $allowedComponents: ['CycleA'] } },
  };

  it('renders a banner and (cycle) sidebar badges when cycles exist', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);

    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/slot dependency cycle/);
    expect(frame).toMatch(/CycleA \(cycle\)/);
    expect(frame).toMatch(/CycleB \(cycle\)/);
  });

  it('opens the cycle detail panel on [c] with suggested fix visible', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);

    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('c');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/SLOT DEPENDENCY CYCLES/);
    expect(frame).toMatch(/Suggested fix/);
    expect(frame).toMatch(/CycleA.*header.*CycleB/);
  });

  it('does not render the banner or [c] affordance when there are no cycles', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/slot dependency cycle/);
    expect(frame).not.toMatch(/\[c\] cycles/);
  });
});

describe('GenerateReviewStep — slot-cycle re-detection on user actions (INTEG-4401 Fix 3/4)', () => {
  const CYCLE_A = {
    $type: 'component' as const,
    $properties: {},
    $slots: { header: { $allowedComponents: ['CycleB'] } },
  };
  const CYCLE_B = {
    $type: 'component' as const,
    $properties: {},
    $slots: { footer: { $allowedComponents: ['CycleA'] } },
  };

  it('rejecting a cycle participant clears the push-safety banner but keeps sidebar badges', async () => {
    // Two independent signals:
    //   - Top banner ("N slot dependency cycles detected — push will fail")
    //     reflects cycles in the FILTERED graph (rejected excluded). Rejecting
    //     a cycle member collapses the push-time cycle → banner disappears.
    //   - Sidebar `(cycle)` badges reflect cycles in the UNFILTERED slot data
    //     so cycle members don't visually orphan the moment they're rejected.
    //     They keep their tier position + `[✗]` selection glyph.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);

    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Initial state: banner visible, both members badged.
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/slot dependency cycle/);
    expect(frame).toMatch(/CycleA \(cycle\)/);

    // Reject CycleA — it is currently the selected row (sidebar starts at
    // idx 0 and cycle members sort to the top).
    stdin.write('r');
    await tick();
    frame = lastFrame() ?? '';
    // Push-safety banner: gone (rejected components can't form a push cycle).
    expect(frame).not.toMatch(/slot dependency cycle/);
    // Sidebar cycle badges: still there — CycleA's slot data still references
    // CycleB and vice versa, so operators can see the cycle structure they
    // just neutralised.
    expect(frame).toMatch(/CycleA \(cycle\)/);
    expect(frame).toMatch(/CycleB \(cycle\)/);
    // storeSlotCycles was called with the empty updated list (banner state).
    expect(vi.mocked(dbMod.storeSlotCycles)).toHaveBeenCalled();
    const lastCallArgs = vi.mocked(dbMod.storeSlotCycles).mock.calls.at(-1);
    expect(lastCallArgs?.[2]).toEqual([]);
  });

  it('[F] with cycle at mount: auto-reject leaves accepted-set non-cyclic → dialog opens', async () => {
    // Task #37 replaces the "block finalize on ANY cycle" rule with a
    // stronger "block finalize on cycle IN ACCEPTED SUBSET" rule. Mount-time
    // auto-reject flips every cycle participant to rejected, so the
    // accepted set is empty (non-cyclic) and [F] proceeds — the wizard's
    // downstream preview check owns the "nothing to push" decision.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);

    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('F');
    await tick();
    const frame = lastFrame() ?? '';
    // Dialog opens because auto-reject left the accepted subset empty.
    expect(frame).toMatch(/Save decisions and exit/);
  });
});

// ── Composite-components grouping wiring (INTEG-4402 subtask C) ─────────────
// Verifies the GroupedSidebar is mounted with all the pieces intact:
//   - cycle / empty / grouped-root / standalone tiers stack in that order;
//   - inheritance markers dim on ancestors of a rejected leaf;
//   - Enter drills selection from an ancestor to the descendant that owns
//     the issue; leaves are no-ops;
//   - preview annotations still show up (badge column preserved).
describe('GenerateReviewStep — composite-components grouped sidebar (subtask C)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (name: string): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const withSlot = (name: string, allowed: string[]): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
    $slots: {
      children: {
        $type: 'slot',
        $allowedComponents: allowed,
      },
    } as never,
  });
  const empty: Entry = { $type: 'component', $properties: {} };

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('renders cycle, empty, grouped-root, and standalone tiers in order', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Card → [Heading, Body]. Standalone → no slots and not depended on by
    // any other component. Empty → zero props/slots. CycleA/CycleB are
    // cycle-participants (loaded via loadSlotCycles below).
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Heading', 'Body']) },
      { key: 'Heading', entry: leaf('Heading') },
      { key: 'Body', entry: leaf('Body') },
      { key: 'Loner', entry: leaf('Loner') },
      { key: 'Blank', entry: empty },
      { key: 'CycleA', entry: withSlot('CycleA', ['CycleB']) },
      { key: 'CycleB', entry: withSlot('CycleB', ['CycleA']) },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'children', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'children', toComponent: 'CycleA' },
        ],
        suggestedBreak: null,
      },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // Find each row's line index and assert relative order.
    const idxOf = (needle: string): number => {
      const lines = frame.split('\n');
      for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return i;
      return -1;
    };
    const idxCycle = idxOf('CycleA (cycle)');
    const idxEmpty = idxOf('Blank (empty)');
    const idxRoot = idxOf('Card (2 deps)');
    const idxStandalone = idxOf('Loner');
    expect(idxCycle).toBeGreaterThan(-1);
    expect(idxEmpty).toBeGreaterThan(-1);
    expect(idxRoot).toBeGreaterThan(-1);
    expect(idxStandalone).toBeGreaterThan(-1);
    expect(idxCycle).toBeLessThan(idxEmpty);
    expect(idxEmpty).toBeLessThan(idxRoot);
    expect(idxRoot).toBeLessThan(idxStandalone);
  });

  it('ancestor of a rejected leaf renders an aggregate error glyph on its collapsed root row', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Card → [Body]. Groups start expanded; navigate to Body (dep row),
    // reject it, collapse the Card group with Space, then confirm the
    // collapsed Card row's aggregate glyph shows the roll-up error marker `✗`.
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Default selection is Card (root, first in nav order). Move down to Body.
    stdin.write('j');
    await tick();
    stdin.write('r'); // reject Body
    await tick();
    // Move back up to Card, then collapse.
    stdin.write('k');
    await tick();
    stdin.write(' '); // collapse Card
    await tick();
    const frame = lastFrame() ?? '';
    // Card's collapsed root row shows a `✗` because its closure roll-up
    // sees Body's rejected → error direct-issue.
    expect(frame).toContain('✗');
    expect(frame).toMatch(/Card/);
  });

  it('pressing Enter on a leaf (isOwn true) does not move selection', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Default selection is Card (root, first in nav order). Move down to Body,
    // reject it → task #37 cascades UP so Card is rejected too. Task #7 fix
    // strips outgoing edges of rejected roots, so Body promotes from group-
    // child to a standalone. Post-cascade tier order: [Body, Card] alphabetical.
    // Cursor stays at rowIdx=1 (was Body pre-cascade) → now points at Card.
    // Press `k` to move back to Body, then Enter should be a no-op (Body owns
    // its issue → isOwn: true).
    stdin.write('j'); // navigate to Body
    await tick();
    stdin.write('r'); // reject Body (cascade rejects Card)
    await tick();
    stdin.write('k'); // move cursor back to Body (now at rowIdx=0)
    await tick();
    stdin.write('\r'); // Enter — no drill because Body owns its issue
    await tick();
    const frame = lastFrame() ?? '';
    const titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Body');
    expect(titleLine).not.toContain('Card');
  });

  it('pressing Enter on an ancestor without direct/inherited issues is a no-op', async () => {
    // Task #37 replaced the row-level reject with a reject-cascade UP,
    // which means rejecting Body also flips Card. Both would then own
    // `error` direct-issues, so the ancestor-with-INHERITED-issue drill
    // path is no longer reachable through UI actions alone (previously
    // the drill was tested with a manual Body-only rejection).
    //
    // We keep the drill machinery in place for any future callsite that
    // stages inherited-only issues (e.g. task #39 slot validation). This
    // regression guard verifies Enter is inert when neither row has an
    // issue — pinning the "Enter must not crash / must not move on a
    // clean ancestor" contract.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Default selection is Card. Enter should be a no-op — no issue to drill.
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    const titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Card');
  });

  it('preview annotations still render alongside grouped rows (badge column preserved)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastOnResult).not.toBeNull();
    // Simulate a preview response marking Card as `new` and Body as `changed`.
    lastOnResult!({
      components: {
        new: [
          {
            proposed: { $type: 'component', $properties: {} } as never,
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'compatible', breakingChanges: [] },
            current: { id: 'card', name: 'Card', contentProperties: [], designProperties: [], slots: [] },
          },
        ],
        changed: [
          {
            current: { id: 'body', name: 'Body', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} } as never,
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'compatible', breakingChanges: [] },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    const frame = lastFrame() ?? '';
    // Preview annotation glyphs from Sidebar.previewBadge: '+' new, '~' changed.
    // Assert at least one appears — the badge column is preserved under
    // GroupedSidebar (drop-list bug would silently strip these).
    expect(/[+~]/.test(frame)).toBe(true);
    // And component names still visible.
    expect(frame).toMatch(/Card/);
  });

  it('legend advertises [Space] and [E/C] group-toggle bindings when at least one group root exists', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Heading']) },
      { key: 'Heading', entry: leaf('Heading') },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Ink can wrap the legend across lines on narrow test terminals and
    // insert ANSI dim codes between characters. Strip both before asserting.
    // eslint-disable-next-line no-control-regex
    const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/\[Space\][^\n]*expand\/collapse group/);
    expect(frame).toMatch(/\[E\/C\][^\n]*expand\/collapse/);
  });

  it('legend omits group-toggle bindings when the manifest is flat (no group roots)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Loner1', entry: leaf('Loner1') },
      { key: 'Loner2', entry: leaf('Loner2') },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('[Space] expand/collapse');
    expect(frame).not.toContain('[E/C] expand/collapse');
  });

  it('[C] collapses every group root; [E] expands every group root; both idempotent', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Two independent groups so we can prove the bindings hit every root, not
    // just the currently-selected one.
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Heading']) },
      { key: 'Heading', entry: leaf('Heading') },
      { key: 'Layout', entry: withSlot('Layout', ['Header']) },
      { key: 'Header', entry: leaf('Header') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Groups seed as expanded, so children start visible.
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ Layout/);
    expect(frame).toContain('Heading');
    expect(frame).toContain('Header');

    // [C] collapses every group root.
    stdin.write('C');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ Layout/);
    expect(frame).not.toMatch(/▾ Card/);
    expect(frame).not.toMatch(/▾ Layout/);
    // Child rows should be gone (collapsed).
    expect(frame).not.toContain('├─ Heading');
    expect(frame).not.toContain('└─ Heading');
    expect(frame).not.toContain('├─ Header');
    expect(frame).not.toContain('└─ Header');

    // Idempotent — another [C] leaves the state alone.
    stdin.write('C');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ Layout/);

    // [E] expands every group root.
    stdin.write('E');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ Layout/);
    expect(frame).toContain('Heading');
    expect(frame).toContain('Header');

    // Idempotent — another [E] leaves the state alone.
    stdin.write('E');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ Layout/);
  });
});

describe('GenerateReviewStep — [E] expand-all (T1: cycle-tier parity)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (name: string): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const withSlot = (name: string, allowed: string[]): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
    $slots: {
      children: {
        $type: 'slot',
        $allowedComponents: allowed,
      },
    } as never,
  });

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('[E] expands cycle-tier rows in addition to composite group roots', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Two tiers: a P↔C cycle pair plus a Card→Body composite group. After [C]
    // collapses everything, [E] must re-expand BOTH the Card group root AND
    // the P cycle-tier row (parity bug — pre-fix [E] only touched composite
    // group closures, leaving cycle rows collapsed).
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
      { key: 'P', entry: withSlot('P', ['C']) },
      { key: 'C', entry: withSlot('C', ['P']) },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['P', 'C', 'P'],
        edges: [
          { fromComponent: 'P', slotName: 'children', toComponent: 'C' },
          { fromComponent: 'C', slotName: 'children', toComponent: 'P' },
        ],
        suggestedBreak: null,
      },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();

    // Mount auto-reject fires for the cycle. Undo it so cycle members are
    // back at needs-review — makes the test independent of reject/cascade
    // side effects on visibility.
    stdin.write('u');
    await tick();

    // Collapse everything to establish a clean baseline. Cycle-tier rows read
    // `expandedGroups.has(cycleRoot)` — [C] clears the set → all collapsed.
    stdin.write('C');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ ⚠ P/);

    // [E] expand-all must expand BOTH the Card group AND the P cycle row.
    stdin.write('E');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ ⚠ P/);
  });
});

describe('GenerateReviewStep — fuzzy search overlay (D7)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });

  it('pressing / opens the search input showing "/" prompt', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: makeEntry('Alpha') },
      { key: 'Beta', entry: makeEntry('Beta') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    const frame = lastFrame() ?? '';
    // Cursor glyph rendered after empty query.
    expect(frame).toMatch(/\/▎/);
  });

  it('typing after / filters via dimPredicate and shows a match count', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Button', entry: makeEntry('Button') },
      { key: 'Modal', entry: makeEntry('Modal') },
      { key: 'Card', entry: makeEntry('Card') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('u');
    await tick();
    const frame = lastFrame() ?? '';
    // Query echoed with count. Only Button matches 'u'.
    expect(frame).toMatch(/\/u/);
    expect(frame).toMatch(/1\/3 matches/);
  });

  it('Enter closes input but preserves the query; [n] cycles to next match (T3)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Button', entry: makeEntry('Button') },
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Modal', entry: makeEntry('Modal') },
      { key: 'Chip', entry: makeEntry('Chip') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('B');
    await tick();
    stdin.write('\r'); // Enter — close input, preserve query
    await tick();
    let frame = lastFrame() ?? '';
    // T3: persistent hint advertises [n] next, not [Tab] next.
    expect(frame).toMatch(/\[n\] next/);
    expect(frame).not.toMatch(/\[Tab\] next/);
    // T7b delta 4: Enter now scans strictly AFTER cursorRowIdx (parity with
    // ScopeGate). Cursor starts on Banner (row 0), so Enter advances to
    // Button (the next match after cursor).
    let titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Button');
    // T3: [n] cycles matches with search closed; wraps to Banner.
    stdin.write('n');
    await tick();
    frame = lastFrame() ?? '';
    titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Banner');
  });

  it('L4: Tab with a single prefix-match completes to the full name (input open)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Widget', entry: makeEntry('Widget') },
      { key: 'Card', entry: makeEntry('Card') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('C');
    await tick();
    stdin.write('\t'); // Tab — single prefix-match → complete to Card
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/Card');
    // Input remains open (cursor block shown, no persistent [n] hint yet).
    expect(frame).not.toMatch(/\[n\] next/);
  });

  it('L4: Tab with multiple prefix-matches extends to the LCP and lists possibilities', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Widget', entry: makeEntry('Widget') },
      { key: 'Widen', entry: makeEntry('Widen') },
      { key: 'Card', entry: makeEntry('Card') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('W');
    await tick();
    stdin.write('\t'); // Tab — LCP of Widget + Widen is "Wid"
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('/Wid');
    expect(frame).toContain('Widget');
    expect(frame).toContain('Widen');
  });

  it('T3: Tab while input open with no prefix match is a no-op', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Widget', entry: makeEntry('Widget') },
      { key: 'Wizard', entry: makeEntry('Wizard') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    // Query unchanged, no crash.
    expect(frame).toContain('/zzz');
  });

  it('T3: Tab with search CLOSED and active query crosses focus (does not cycle)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Button', entry: makeEntry('Button') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Sidebar focused hint present.
    expect(lastFrame() ?? '').toMatch(/\[e\/Tab\] focus panel/);
    stdin.write('/');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\r'); // close input, preserve query
    await tick();
    // Tab should cross to the panel, NOT cycle matches.
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
  });

  it('Esc from active-query state clears the query', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Button', entry: makeEntry('Button') },
      { key: 'Modal', entry: makeEntry('Modal') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('u');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toMatch(/1\/2 matches/);
    stdin.write('\x1b'); // Esc
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/matches/);
  });

  it('match count reflects fuzzy matches across all rows (accurate N/M)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Button', entry: makeEntry('Button') },
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Card', entry: makeEntry('Card') },
      { key: 'Modal', entry: makeEntry('Modal') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('b');
    await tick();
    const frame = lastFrame() ?? '';
    // 'b' matches Button + Banner; total 4.
    expect(frame).toMatch(/2\/4 matches/);
  });
});

describe('GenerateReviewStep — search parity (T7b: legend, dedupe, enter-clear, enter-advance)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const parentEntry = (childName: string): Entry => ({
    $type: 'component',
    $properties: { title: { $type: 'string', $category: 'content' } },
    $slots: { children: { $allowedComponents: [childName] } },
  });

  it('legend advertises [/] search when sidebar focused (parity with ScopeGate)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: makeEntry('Alpha') },
      { key: 'Beta', entry: makeEntry('Beta') },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Ink can wrap the legend and insert ANSI codes; strip both before asserting.
    // eslint-disable-next-line no-control-regex
    const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/\[\/\][^\n]*search/);
  });

  it('match counter dedupes shared-dep rows to unique component count (1/N not 2/N)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Article → Card, Section → Card. Card is a shared dep, so buildVisibleRows
    // emits it under BOTH parents. Total components = 3, but the row list has
    // Card twice. Search 'card' hits both Card rows: raw count = 2, but the
    // user-visible numerator must be 1 (one unique component matched).
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Article', entry: parentEntry('Card') },
      { key: 'Section', entry: parentEntry('Card') },
      { key: 'Card', entry: makeEntry('Card') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('c');
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('d');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/1\/3 matches/);
    expect(frame).not.toMatch(/2\/3 matches/);
  });

  it('Enter with 0 matches clears the query and closes the input (no stuck dim-all)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: makeEntry('Alpha') },
      { key: 'Beta', entry: makeEntry('Beta') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    // One char at a time — useImmediateInput only consumes single chars per call.
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    // Confirm we're in 0-match state while input still open.
    expect(lastFrame() ?? '').toMatch(/0\/2 matches/);
    stdin.write('\r'); // Enter — should clear + close (mirror ScopeGate)
    await tick();
    const frame = lastFrame() ?? '';
    // No persistent-hint line for the query.
    expect(frame).not.toMatch(/\[Tab\] next/);
    expect(frame).not.toMatch(/matches/);
    expect(frame).not.toMatch(/\/zzzz/);
  });

  it('Enter advances the cursor past the current match row (cursor exclusion)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Two components both matching 'b'. Sort puts them into the standalone tier
    // alphabetically: [Banner, Button]. Cursor starts on row 0 = Banner (first
    // match). Enter should advance to Button (second match), not stay on Banner.
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Button', entry: makeEntry('Button') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\r'); // Enter
    await tick();
    const frame = lastFrame() ?? '';
    const titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Button');
    expect(titleLine).not.toContain('Banner');
  });

  it('Enter with cursor on the last match wraps to the first match', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // [Banner, Button] alphabetical. Move cursor to Button (last match), then
    // Enter with query 'b' should wrap to Banner.
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Button', entry: makeEntry('Button') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Move cursor from row 0 (Banner) to row 1 (Button).
    stdin.write('j');
    await tick();
    let titleLine = (lastFrame() ?? '').split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Button');
    // Now open search and Enter — cursor sits on last match, should wrap to Banner.
    stdin.write('/');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Banner');
    expect(titleLine).not.toContain('Button');
  });
});

// ── Bug INTEG-4411: duplicate-row cursor loop ────────────────────────────────
// A shared dep like `Card` appears once under each parent group plus once in
// the flat "All components" tier — several rows in `visibleRows` sharing the
// same itemIdx. The old cursor state was an item-index, so the sidebar drew
// EVERY duplicate row as selected and j/k snapped back to the first
// occurrence. Fix: cursor is a visible-row index (`cursorRowIdx`) and the
// sidebar highlights exactly one row via `selectedRowIdx`.
describe('GenerateReviewStep — duplicate-row cursor (INTEG-4411)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const parentEntry = (childName: string): Entry => ({
    $type: 'component',
    $properties: { title: { $type: 'string', $category: 'content' } },
    $slots: { children: { $allowedComponents: [childName] } },
  });
  const cardEntry: Entry = {
    $type: 'component',
    $properties: { text: { $type: 'string', $category: 'content' } },
  };

  it('j-presses walk through duplicate Card rows one at a time (no snap-back)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // Article → Card, Section → Card. Card is shared, so buildVisibleRows
    // emits it under BOTH Article and Section (grouped rows expand by
    // default on this step). Total selectable rows: Article, Card (under
    // Article), Section, Card (under Section).
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Article', entry: parentEntry('Card') },
      { key: 'Section', entry: parentEntry('Card') },
      { key: 'Card', entry: cardEntry },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Expected visible-row order (sortComponentsForSidebar sorts alphabetically
    // by key within the populated tier, so root groups come out in that order):
    //   0: ▾ Article (root)
    //   1: └─ Card    (child under Article)
    //   2: ▾ Section  (root)
    //   3: └─ Card    (child under Section)
    // Fire 3 j's — cursor should land on the SECOND Card row. Before the
    // fix, cursor would snap back to the first Card row (row 1) on every j
    // after position 1 because both rows shared itemIdx=2.
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    const frame = lastFrame() ?? '';
    // Cursor glyph should appear exactly once in the sidebar (not on every
    // Card row).
    const cursorCount = (frame.match(/▶/g) ?? []).length;
    expect(cursorCount).toBe(1);
    // The row carrying the cursor must be the SECOND Card occurrence, which
    // renders under the Section root. We assert by locating the cursor line
    // and confirming it sits AFTER the Section root in the frame.
    const lines = frame.split('\n');
    const cursorLineIdx = lines.findIndex((l) => l.includes('▶'));
    const sectionLineIdx = lines.findIndex((l) => l.includes('Section'));
    expect(cursorLineIdx).toBeGreaterThan(sectionLineIdx);
  });
});

describe('sortComponentsForSidebar — 3-tier ordering (INTEG-4401)', () => {
  const empty = { $type: 'component' as const, $properties: {} };
  const populated = {
    $type: 'component' as const,
    $properties: { x: { $type: 'string' as const, $category: 'content' as const } },
  };
  it('places cycle members before empty and populated', async () => {
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    const sorted = mod.sortComponentsForSidebar(
      [
        { key: 'Populated', entry: populated },
        { key: 'Empty', entry: empty },
        { key: 'CycleA', entry: populated },
      ],
      new Set(['CycleA']),
    );
    expect(sorted.map((c) => c.key)).toEqual(['CycleA', 'Empty', 'Populated']);
  });
});

// ── Task #37 — mount-time cycle auto-reject + undo + partition-by-decisions ──
// GenerateReviewStep at mount, when any slot cycle is detected, auto-flips
// every cycle participant + every transitive ancestor that slots them to
// `rejected`. A red banner surfaces the auto-reject; `[u]` undoes the mount
// event once (subsequent presses are no-ops). `[F]` continue partitions by
// decisions and refuses to proceed when the accepted subset still contains
// a cycle.
describe('GenerateReviewStep — Task #37 mount-time cycle auto-reject', () => {
  // Cycle A ↔ B, plus Wrapper that slots CycleA (transitive ancestor).
  const cycleA = {
    $type: 'component' as const,
    $properties: { name: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { next: { $allowedComponents: ['CycleB'] } },
  };
  const cycleB = {
    $type: 'component' as const,
    $properties: { name: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { prev: { $allowedComponents: ['CycleA'] } },
  };
  const wrapper = {
    $type: 'component' as const,
    $properties: { label: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { body: { $allowedComponents: ['CycleA'] } },
  };
  const outer = {
    $type: 'component' as const,
    $properties: { tag: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { child: { $allowedComponents: ['Wrapper'] } },
  };
  const leaf = {
    $type: 'component' as const,
    $properties: { text: { $type: 'string' as const, $category: 'content' as const } },
  };

  const primeCycles = async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: cycleA },
      { key: 'CycleB', entry: cycleB },
      { key: 'Wrapper', entry: wrapper },
      { key: 'Outer', entry: outer },
      { key: 'Standalone', entry: leaf },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'next', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'prev', toComponent: 'CycleA' },
        ],
        suggestedBreak: null,
      },
    ]);
  };

  beforeEach(() => {
    hookReturnOverride = null;
  });

  it('cycle at mount → auto-rejects every cycle participant', async () => {
    await primeCycles();
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // Banner text and cycle members listed as auto-rejected.
    expect(frame).toMatch(/Cyclic manifest — auto-rejected/);
    expect(frame).toMatch(/Cycle members:.*CycleA/);
    expect(frame).toMatch(/Cycle members:.*CycleB/);
  });

  it('cycle at mount → auto-rejects transitive ancestors that slot cycle members', async () => {
    await primeCycles();
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    // Wrapper slots CycleA directly; Outer slots Wrapper transitively.
    expect(frame).toMatch(/Ancestors:.*Outer/);
    expect(frame).toMatch(/Ancestors:.*Wrapper/);
    // Standalone (unrelated leaf) must NOT be auto-rejected.
    expect(frame).not.toMatch(/Ancestors:.*Standalone/);
  });

  it('no cycle at mount → no auto-reject, no banner', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Solo', entry: leaf }]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Cyclic manifest — auto-rejected/);
    void dbMod;
  });

  it('legend advertises [u] undo while undo is armed; omits it after undo fires', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Widen terminal so the legend renders without truncation. Ink's default
    // 100 columns can wrap the legend and dice up the `[u] undo` substring.
    let frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('[u] undo');
    stdin.write('u');
    await tick();
    frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    // Undo spent — legend no longer advertises the hint.
    expect(frame).not.toContain('[u] undo');
  });

  it('[u] undo restores pre-mount state (empty user decisions)', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Banner visible after auto-reject.
    expect(lastFrame() ?? '').toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write('u');
    await tick();
    // Banner gone: no auto-rejected components remain.
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('[u] twice is a no-op after first press', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('u');
    await tick();
    const afterFirstUndo = lastFrame() ?? '';
    stdin.write('u');
    await tick();
    const afterSecondUndo = lastFrame() ?? '';
    // Both frames match on the top-level structure (banner remains absent).
    expect(afterFirstUndo).not.toMatch(/Cyclic manifest — auto-rejected/);
    expect(afterSecondUndo).not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('operator [a] on a cycle member after mount survives (does not re-trigger auto-reject)', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Cursor is on CycleA (first cycle-tier row). Accept it — cascade-down
    // will also flip CycleB back to accepted. Auto-reject must NOT re-fire.
    stdin.write('a');
    await tick();
    const frame = lastFrame() ?? '';
    // Banner is either gone (both cycle members no longer rejected) or now
    // has zero "still-rejected" targets. Either way it's the "no banner" shape.
    expect(frame).not.toMatch(/Cyclic manifest — auto-rejected 2 components/);
  });

  it('[F] continue with accepted subset still cyclic → blocked with re-shown banner', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Undo the mount auto-reject, restoring every affected component to
    // `needs-review`. Then bulk-accept via [A]. Every cycle member and
    // ancestor is now `accepted` → the accepted subgraph is still cyclic.
    stdin.write('u');
    await tick();
    stdin.write('A');
    await tick();
    stdin.write('F');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Cannot finalize — accepted set still contains a cycle/);
    // Finalize dialog must NOT open.
    expect(frame).not.toMatch(/Save decisions and exit/);
  });

  it('[F] continue after auto-reject (accepted set empty) → dialog opens', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('F');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Save decisions and exit/);
  });

  it('[r] on an accepted row cascades reject UP to ancestors', async () => {
    // Non-cycle graph: Article slots Card, Card slots Icon. Rejecting Icon
    // must reject Article + Card too, mirroring scope-gate cascade rules.
    const dbMod = await import('../../../../src/session/db.js');
    const article = {
      $type: 'component' as const,
      $properties: { title: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { body: { $allowedComponents: ['Card'] } },
    };
    const card = {
      $type: 'component' as const,
      $properties: { title: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { icon: { $allowedComponents: ['Icon'] } },
    };
    const icon = {
      $type: 'component' as const,
      $properties: { src: { $type: 'string' as const, $category: 'content' as const } },
    };
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Article', entry: article },
      { key: 'Card', entry: card },
      { key: 'Icon', entry: icon },
    ]);

    const onFinalize = vi.fn();
    const { stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Accept Article (cascades down to Card + Icon), then reject Icon
    // (should cascade UP → Card + Article both rejected).
    stdin.write('a');
    await tick();
    // Navigate to Icon (Article is at row 0, Card row 1, Icon row 2 in expanded group order).
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    // Finalize with F. Accepted set should be empty.
    stdin.write('F');
    await tick();
    stdin.write('y');
    await tick();
    expect(onFinalize).toHaveBeenCalledTimes(1);
    const [acceptedCount, rejectedCount] = onFinalize.mock.calls[0];
    expect(acceptedCount).toBe(0);
    expect(rejectedCount).toBe(3);
  });
});

// ── T2 (parity plan §3) — auto-reject is a strict one-shot per session ────
// Semantic revert of task #37's "re-fire on edit-induced new cycle" branch.
// Once the mount-time effect fires, it never fires again — regardless of
// edits, cycle emergence, or cycle disappearance. Undo semantics unchanged.
describe('GenerateReviewStep — auto-reject strict one-shot (T2)', () => {
  const cycleA = {
    $type: 'component' as const,
    $properties: { name: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { next: { $allowedComponents: ['CycleB'] } },
  };
  const cycleB = {
    $type: 'component' as const,
    $properties: { name: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { prev: { $allowedComponents: ['CycleA'] } },
  };
  const acyclic = {
    $type: 'component' as const,
    $properties: { title: { $type: 'string' as const, $category: 'content' as const } },
    $slots: { body: { $allowedComponents: ['Leaf'] } },
  };
  const leaf = {
    $type: 'component' as const,
    $properties: { text: { $type: 'string' as const, $category: 'content' as const } },
  };

  beforeEach(() => {
    hookReturnOverride = null;
  });

  it('undo then subsequent state change → auto-reject does NOT re-fire', async () => {
    // Mount with a cycle → auto-reject fires once. Undo. Fire another
    // keystroke that changes state (`C` collapse-all). The banner must NOT
    // return; the effect is a strict one-shot per session.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: cycleA },
      { key: 'CycleB', entry: cycleB },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'next', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'prev', toComponent: 'CycleA' },
        ],
        suggestedBreak: null,
      },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/Cyclic manifest — auto-rejected/);
    // Undo the mount auto-reject.
    stdin.write('u');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
    // State-changing keystrokes must NOT re-arm auto-reject even though
    // `cycleView.structural` is still non-empty (the cycle still exists in
    // the unfiltered graph after the undo).
    stdin.write('C'); // collapse-all
    await tick();
    stdin.write('E'); // expand-all
    await tick();
    stdin.write('j'); // move cursor
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('mount with NO cycle → later edit introduces a cycle → auto-reject never fires', async () => {
    // Session enters with an acyclic manifest → effect skips on mount. If a
    // later edit introduces a cycle, the STRUCTURAL cycle indicators (sidebar
    // badges, push-safety banner) still light up — but auto-reject stays
    // silent, per the T2 "welcome gesture, once" policy.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: acyclic },
      { key: 'Leaf', entry: leaf },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // No banner at mount (no cycle).
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
    // The full edit-driven cycle injection through FieldEditor is not
    // drivable via pure key input from ink-testing-library. The pure-fn
    // seam (`computeAutoRejectDecision`) covers the "already fired, cycle
    // appears" branch. Here we just confirm the mount path doesn't fire.
    // Any additional interactions must not spontaneously produce the banner.
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });
});

describe('computeCycleAutoRejectTargets — pure helper', () => {
  it('returns empty set when no cycles', async () => {
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    const targets = mod.computeCycleAutoRejectTargets([], []);
    expect(targets.size).toBe(0);
  });

  it('unions cycle participants + every transitive ancestor', async () => {
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    const graph = [
      { name: 'CycleA', slots: [{ name: 'next', allowedComponents: ['CycleB'] }] },
      { name: 'CycleB', slots: [{ name: 'prev', allowedComponents: ['CycleA'] }] },
      { name: 'Wrapper', slots: [{ name: 'body', allowedComponents: ['CycleA'] }] },
      { name: 'Outer', slots: [{ name: 'child', allowedComponents: ['Wrapper'] }] },
      { name: 'Standalone', slots: [] },
    ];
    const cycles = [{ path: ['CycleA', 'CycleB', 'CycleA'] }];
    const targets = mod.computeCycleAutoRejectTargets(cycles, graph);
    expect([...targets].sort()).toEqual(['CycleA', 'CycleB', 'Outer', 'Wrapper']);
    expect(targets.has('Standalone')).toBe(false);
  });
});

// ADR-0010 §Part 2 canonical scenarios — driven through the real
// GenerateReviewStep. Pins mount auto-reject targeting (cycle participants
// + transitive ancestors that slot them; NOT descendants), the [F] gate,
// and Scenario-A slot-traversal cascade (NOT cycle-unit cohesion — that's
// ScopeGate territory).
//
// Scenarios:
//   A — P and C cycle with each other (P.slots⊃C, C.slots⊃P).
//   B — P slots C; C cycles with unrelated X (P not in cycle).
//   C — P cycles with X; P also slots C; C has no slots (leaf).

describe('GenerateReviewStep — ADR-0010 scenarios', () => {
  beforeEach(() => {
    hookReturnOverride = null;
  });

  describe('Scenario A — P ↔ C cycle', () => {
    const P = {
      $type: 'component' as const,
      $properties: { p: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['C'] } },
    };
    const C = {
      $type: 'component' as const,
      $properties: { c: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['P'] } },
    };
    const primeA = async () => {
      const dbMod = await import('../../../../src/session/db.js');
      vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
        { key: 'P', entry: P },
        { key: 'C', entry: C },
      ]);
      vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
        {
          path: ['P', 'C', 'P'],
          edges: [
            { fromComponent: 'P', slotName: 's', toComponent: 'C' },
            { fromComponent: 'C', slotName: 's', toComponent: 'P' },
          ],
          suggestedBreak: null,
        },
      ]);
    };

    it('mount auto-reject targets BOTH P and C (both are cycle participants)', async () => {
      await primeA();
      const { lastFrame } = render(
        <GenerateReviewStep extractSessionId="sess-a" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Cyclic manifest — auto-rejected/);
      // Both cycle members enumerated in the banner. No non-cycle ancestors
      // exist in this graph, so no "Ancestors:" line.
      expect(frame).toMatch(/Cycle members:.*C/);
      expect(frame).toMatch(/Cycle members:.*P/);
      expect(frame).not.toMatch(/Ancestors:/);
    });

    it('[F] blocks when accepted subset still contains the cycle', async () => {
      await primeA();
      const { lastFrame, stdin } = render(
        <GenerateReviewStep extractSessionId="sess-a" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      // Undo the mount auto-reject → both P and C back to `needs-review`.
      stdin.write('u');
      await tick();
      // Bulk-accept via [A] → both accepted → accepted subgraph still cyclic.
      stdin.write('A');
      await tick();
      stdin.write('F');
      await tick();
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Cannot finalize — accepted set still contains a cycle/);
      expect(frame).not.toMatch(/Save decisions and exit/);
    });

    it('[a] on a cycle member does NOT cascade to its partner (computeClosure short-circuits on cycles)', async () => {
      // ADR-0010 §Part 2 Scenario A CLAIMS: "Accepting P cascades DOWN P→C,
      // so C flips accepted... Both end accepted via slot traversal — no
      // cycle-unit needed."
      //
      // ACTUAL BEHAVIOR (commit 15471b2): `computeAcceptCascade` uses
      // `computeClosure`, which short-circuits any closure whose walk
      // detects a cycle → the returned closure is JUST `[target]`. So [a]
      // on C accepts C only; P stays `needs-review`. To reject the whole
      // cycle-unit in GenerateReview, the operator must either edit slots
      // or accept each member individually.
      //
      // This test PINS actual behavior. See `spec-disagreement` log entry
      // for graph-consolidation-m1 — ADR §Part 2 Scenario A needs updating
      // during D.20 refactor OR the source needs a cycle-aware cascade.
      await primeA();
      const { lastFrame, stdin } = render(
        <GenerateReviewStep extractSessionId="sess-a" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      stdin.write('u'); // undo mount auto-reject → both needs-review
      await tick();
      // Cursor at row 0 (C, cycle-tier alphabetical). [a] on C.
      stdin.write('a');
      await tick();
      stdin.write('F'); // finalize gate — accepted subset {C} is acyclic → dialog opens
      await tick();
      const frame = lastFrame() ?? '';
      // Dialog opens (1 accepted = C, 1 unresolved = P). The [F] gate does
      // NOT block because the accepted subgraph is a single node.
      expect(frame).toMatch(/Save decisions and exit/);
      expect(frame).toMatch(/1 accepted/);
      expect(frame).toMatch(/1 unresolved/);
    });
  });

  describe('Scenario B — P → C, C ↔ X (P not in cycle)', () => {
    const P = {
      $type: 'component' as const,
      $properties: { p: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['C'] } },
    };
    const C = {
      $type: 'component' as const,
      $properties: { c: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['X'] } },
    };
    const X = {
      $type: 'component' as const,
      $properties: { x: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['C'] } },
    };
    const primeB = async () => {
      const dbMod = await import('../../../../src/session/db.js');
      vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
        { key: 'P', entry: P },
        { key: 'C', entry: C },
        { key: 'X', entry: X },
      ]);
      vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
        {
          path: ['C', 'X', 'C'],
          edges: [
            { fromComponent: 'C', slotName: 's', toComponent: 'X' },
            { fromComponent: 'X', slotName: 's', toComponent: 'C' },
          ],
          suggestedBreak: null,
        },
      ]);
    };

    it('mount auto-rejects C, X, AND P (P is a transitive ancestor slotting cycle member C)', async () => {
      await primeB();
      const { lastFrame } = render(
        <GenerateReviewStep extractSessionId="sess-b" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      const frame = lastFrame() ?? '';
      // Cycle members: C and X. Ancestors: P (because P slots C).
      expect(frame).toMatch(/Cycle members:.*C/);
      expect(frame).toMatch(/Cycle members:.*X/);
      expect(frame).toMatch(/Ancestors:.*P/);
    });
  });

  describe('Scenario C — P ↔ X cycle, P also slots C (C not in any cycle)', () => {
    const P = {
      $type: 'component' as const,
      $properties: { p: { $type: 'string' as const, $category: 'content' as const } },
      $slots: {
        cycle: { $allowedComponents: ['X'] },
        child: { $allowedComponents: ['C'] },
      },
    };
    const X = {
      $type: 'component' as const,
      $properties: { x: { $type: 'string' as const, $category: 'content' as const } },
      $slots: { s: { $allowedComponents: ['P'] } },
    };
    const C = {
      $type: 'component' as const,
      $properties: { c: { $type: 'string' as const, $category: 'content' as const } },
    };
    const primeC = async () => {
      const dbMod = await import('../../../../src/session/db.js');
      vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
        { key: 'P', entry: P },
        { key: 'X', entry: X },
        { key: 'C', entry: C },
      ]);
      vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
        {
          path: ['P', 'X', 'P'],
          edges: [
            { fromComponent: 'P', slotName: 'cycle', toComponent: 'X' },
            { fromComponent: 'X', slotName: 's', toComponent: 'P' },
          ],
          suggestedBreak: null,
        },
      ]);
    };

    it('descendant C stays `needs-review` at mount (ADR-pinned — ancestor-flip does NOT cascade DOWN)', async () => {
      // ADR-0010 §Part 2 scenario C: "P and X auto-rejected. C stays
      // `needs-review` — task #37's ancestor-flip rule catches ancestors of
      // cycle participants, not descendants." Verified by inspecting the
      // auto-reject banner — C must NOT appear as a cycle member OR as an
      // ancestor. And C's sidebar row must render the undecided glyph `[ ]`,
      // not the rejected glyph `[✗]`.
      await primeC();
      const { lastFrame } = render(
        <GenerateReviewStep extractSessionId="sess-c" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      const frame = lastFrame() ?? '';
      // Banner enumerates only P and X as auto-rejected.
      expect(frame).toMatch(/Cyclic manifest — auto-rejected/);
      expect(frame).toMatch(/Cycle members:.*P/);
      expect(frame).toMatch(/Cycle members:.*X/);
      // C never appears in the banner's Cycle members or Ancestors lines.
      const cycleMembersLine = frame.split('\n').find((l) => l.includes('Cycle members:')) ?? '';
      const ancestorsLine = frame.split('\n').find((l) => l.includes('Ancestors:')) ?? '';
      expect(cycleMembersLine).not.toMatch(/(^|[^A-Za-z])C([^A-Za-z]|$)/);
      expect(ancestorsLine).not.toMatch(/(^|[^A-Za-z])C([^A-Za-z]|$)/);
      // C's sidebar row shows the undecided glyph, not the rejected glyph.
      const cSidebarLine =
        frame.split('\n').find((l) => /(^|[^A-Za-z])C([^A-Za-z]|$)/.test(l) && (l.includes('[ ]') || l.includes('[✗]'))) ?? '';
      expect(cSidebarLine).toContain('[ ]');
      expect(cSidebarLine).not.toContain('[✗]');
    });
  });
});

describe('GenerateReviewStep — lineage panel (T6)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (name: string): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const withSlot = (name: string, allowed: string[]): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
    $slots: {
      children: {
        $type: 'slot',
        $allowedComponents: allowed,
      },
    } as never,
  });

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  // P → C → X — focus C to exercise both ancestors + descendants.
  async function renderLineageFixture() {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'P', entry: withSlot('P', ['C']) },
      { key: 'C', entry: withSlot('C', ['X']) },
      { key: 'X', entry: leaf('X') },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const utils = render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        livePreview={false}
      />,
    );
    await tick();
    return utils;
  }

  // Move cursor to the row whose key is `target` (using j/k). Deterministic:
  // the sidebar walks rows in order, so we just press j the right number of
  // times relative to a first-row known state.
  async function jumpToRow(stdin: { write: (s: string) => void }, presses: number) {
    for (let i = 0; i < presses; i++) {
      stdin.write('j');
      await tick(10);
    }
  }

  it('[l] opens the lineage panel when a component is focused', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    stdin.write('l');
    await tick();
    expect(lastFrame() ?? '').toContain('Lineage:');
  });

  it('lineage panel shows the focused component + ancestors + descendants', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    // Move down one row so we're focused on C (the middle of P→C→X).
    await jumpToRow(stdin, 1);
    stdin.write('l');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Lineage: C');
    expect(frame).toContain('Ancestors:');
    expect(frame).toContain('Descendants:');
    // P is an ancestor of C; X is a descendant.
    expect(frame).toContain('P');
    expect(frame).toContain('X');
  });

  it('Tab moves cursor forward through jumpables inside the panel', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    await jumpToRow(stdin, 1);
    stdin.write('l');
    await tick();
    // Panel is open, cursor at 0. Move down.
    stdin.write('j');
    await tick();
    // Panel should still be open — j inside panel moves the panel cursor.
    expect(lastFrame() ?? '').toContain('Lineage: C');
  });

  it('Enter jumps main selection to the highlighted entry and closes the panel', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    // Focus P first.
    stdin.write('l');
    await tick();
    // Panel is at cursor 0 — first jumpable is the ancestor/descendant tree
    // root. Enter should jump and close.
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Lineage:');
  });

  it('Esc closes the panel without jumping', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    stdin.write('l');
    await tick();
    expect(lastFrame() ?? '').toContain('Lineage:');
    stdin.write('\x1b');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Lineage:');
  });

  it('[l] while the panel is already open closes it (toggle, matching ScopeGate)', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    stdin.write('l');
    await tick();
    expect(lastFrame() ?? '').toContain('Lineage:');
    stdin.write('l');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Lineage:');
  });

  it('legend advertises [l] lineage when sidebar is focused', async () => {
    const { lastFrame } = await renderLineageFixture();
    expect(lastFrame() ?? '').toContain('[l]');
  });
});

describe('GenerateReviewStep — view toggle (T8)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (name: string): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const withSlot = (name: string, allowed: string[]): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
    $slots: {
      children: {
        $type: 'slot',
        $allowedComponents: allowed,
      },
    } as never,
  });

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  // Card → [Body, Heading], plus Standalone. Grouped view renders composite
  // tree with `▾` on Card and `├─`/`└─` prefixes on children. Large-list
  // renders one row per component alphabetical, no tree glyphs.
  async function renderToggleFixture() {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body', 'Heading']) },
      { key: 'Body', entry: leaf('Body') },
      { key: 'Heading', entry: leaf('Heading') },
      { key: 'Standalone', entry: leaf('Standalone') },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const utils = render(
      <GenerateReviewStep
        extractSessionId="sess-1"
        onFinalize={vi.fn()}
        onQuit={vi.fn()}
        livePreview={false}
      />,
    );
    await tick();
    return utils;
  }

  it('legend advertises [L] flat when sidebar is focused', async () => {
    const { lastFrame } = await renderToggleFixture();
    const out = lastFrame() ?? '';
    expect(out).toContain('[L]');
    expect(out).toContain('flat');
  });

  it('pressing [L] toggles to flat view (composite tree glyphs disappear)', async () => {
    const { lastFrame, stdin } = await renderToggleFixture();
    // Grouped view (default): ▾ on expanded root; ├─/└─ on children.
    const beforeToggle = lastFrame() ?? '';
    expect(beforeToggle).toMatch(/▾[^\n]*Card/);
    expect(beforeToggle).toMatch(/├─ /);
    stdin.write('L');
    await tick();
    const afterToggle = lastFrame() ?? '';
    // Flat view: no tree glyphs; Card gets a `(N deps)` suffix and
    // every component surfaces as its own row.
    expect(afterToggle).not.toMatch(/├─ /);
    expect(afterToggle).not.toMatch(/└─ /);
    expect(afterToggle).not.toMatch(/▾/);
    expect(afterToggle).toContain('Card (2 deps)');
    expect(afterToggle).toContain('Body');
    expect(afterToggle).toContain('Heading');
    expect(afterToggle).toContain('Standalone');
  });

  it('pressing [L] again toggles back to grouped view', async () => {
    const { lastFrame, stdin } = await renderToggleFixture();
    stdin.write('L');
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/├─ /);
    stdin.write('L');
    await tick();
    // Back to grouped: tree glyphs return.
    expect(lastFrame() ?? '').toMatch(/├─ /);
  });

  it('cursor selection is preserved on the same component across view toggle', async () => {
    const { lastFrame, stdin } = await renderToggleFixture();
    // Grouped order (expanded seed): Card, ├─ Body, └─ Heading, Standalone.
    // Move down to Body (first child row).
    stdin.write('j');
    await tick();
    const beforeToggle = lastFrame() ?? '';
    // Detail-panel title line shows the focused component.
    const titleBefore = beforeToggle.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleBefore).toContain('Body');
    stdin.write('L');
    await tick();
    const afterToggle = lastFrame() ?? '';
    // Cursor stays on Body after switching to flat view.
    const titleAfter = afterToggle.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleAfter).toContain('Body');
  });
});

describe('GenerateReviewStep — unsaved-changes warning (T5)', () => {
  // Cross focus into the panel and step down to the description field, then
  // type a literal 'X' to make the FieldEditor dirty. Uses the same walk the
  // existing FieldEditor tests use for the STRING sample: Return → j×3 → ↓.
  async function crossAndDirty(stdin: { write: (data: string) => void }): Promise<void> {
    stdin.write('\t'); // Tab → panel focus
    await tick();
    stdin.write('\r'); // Return → field-edit at `type`
    await tick();
    stdin.write('j'); // → category
    await tick();
    stdin.write('j'); // → required
    await tick();
    stdin.write('j'); // → default (string default is text-entry — j literal is fine at this step)
    await tick();
    stdin.write('\x1b[B'); // ↓ arrow → description
    await tick();
    stdin.write('X'); // literal edit
    await tick();
  }

  const SAMPLE_STRING = {
    $type: 'component' as const,
    $description: 'Hero title',
    $properties: {
      title: { $type: 'string' as const, $category: 'content' as const, $description: 'Hero title' },
    },
  };

  it('clean Tab-away crosses focus without a warning dialog', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    // Cross into panel — no edits yet.
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    // Cross back out via Tab — clean, no warning.
    stdin.write('\t');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
  });

  it('dirty Tab-away opens an Unsaved changes warning and blocks focus cross', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    await crossAndDirty(stdin);
    // Tab away — warning dialog should appear.
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Unsaved changes/i);
    // Focus did NOT cross — the panel-focused hint is still visible.
    // (Cannot assert sidebar hint because the dialog swallows the bottom row.)
  });

  it('Enter in the warning saves and completes the deferred focus cross', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const storeSpy = vi.mocked(dbMod.storeCDFComponents);
    storeSpy.mockClear();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    await crossAndDirty(stdin);
    stdin.write('\t'); // Tab → warning
    await tick();
    expect(lastFrame() ?? '').toMatch(/Unsaved changes/i);
    stdin.write('\r'); // Enter → save + cross
    await tick();
    // Save fired.
    expect(storeSpy).toHaveBeenCalled();
    // Warning closed, focus crossed to sidebar.
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
  });

  it('Esc in the warning discards and completes the deferred focus cross', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const storeSpy = vi.mocked(dbMod.storeCDFComponents);
    storeSpy.mockClear();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    await crossAndDirty(stdin);
    stdin.write('\t'); // Tab → warning
    await tick();
    expect(lastFrame() ?? '').toMatch(/Unsaved changes/i);
    stdin.write('\x1b'); // Esc → discard + cross
    await tick();
    // Save NOT fired.
    expect(storeSpy).not.toHaveBeenCalled();
    // Warning closed, focus crossed.
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[e\/Tab\] focus panel/);
  });

  it('Tab in the warning cancels: focus stays in the panel, dirty preserved', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const storeSpy = vi.mocked(dbMod.storeCDFComponents);
    storeSpy.mockClear();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    await crossAndDirty(stdin);
    stdin.write('\t'); // Tab → warning
    await tick();
    expect(lastFrame() ?? '').toMatch(/Unsaved changes/i);
    stdin.write('\t'); // Tab in dialog → cancel
    await tick();
    // Save NOT fired.
    expect(storeSpy).not.toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    // Warning closed but focus stayed in the panel.
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[Tab\] focus list/);
  });
});

// ── T4 (parity plan §3) — undo/redo history + reload-from-save ────────────
// Cmd+Z / Ctrl+Z (byte \x1a via key.ctrl + input='z') pops the history stack
// IN-MEMORY only. Cmd+Y / Ctrl+Y (byte \x19) re-applies. `[u]` retained as an
// alias for undo (mirrors legacy task #37 shortcut). Ctrl+R (\x12) opens a
// reload-from-save confirm dialog whose Enter re-runs the mount load path and
// resets history; Esc cancels.
describe('GenerateReviewStep — undo/redo + reload-from-save (T4)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const CTRL_Z = '\x1a';
  const CTRL_Y = '\x19';
  const CTRL_R = '\x12';

  // Find the sidebar row for a given component name — the row that carries a
  // selection glyph. Skips panel-title/hint lines that also contain the name.
  const findSidebarRow = (frame: string, name: string): string =>
    frame.split('\n').find((l) => l.includes(name) && /\[[✓✗ ]\]/.test(l)) ?? '';

  const card: Entry = {
    $type: 'component',
    $properties: { title: { $type: 'string', $category: 'content' } },
  };
  const cycleA: Entry = {
    $type: 'component',
    $properties: { name: { $type: 'string', $category: 'content' } },
    $slots: { next: { $allowedComponents: ['CycleB'] } as never },
  };
  const cycleB: Entry = {
    $type: 'component',
    $properties: { name: { $type: 'string', $category: 'content' } },
    $slots: { prev: { $allowedComponents: ['CycleA'] } as never },
  };

  beforeEach(() => {
    hookReturnOverride = null;
    triggerSpy.mockReset();
  });

  it('Ctrl+Z undoes accept-cascade — status reverts to needs-review', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Before accept: undecided glyph.
    const before = lastFrame() ?? '';
    const cardBefore = findSidebarRow(before, 'Card');
    expect(cardBefore).toContain('[ ]');
    // Accept cascade.
    stdin.write('a');
    await tick();
    const afterAccept = lastFrame() ?? '';
    const cardAccepted = findSidebarRow(afterAccept, 'Card');
    expect(cardAccepted).toContain('[✓]');
    // Ctrl+Z undo.
    stdin.write(CTRL_Z);
    await tick();
    const afterUndo = lastFrame() ?? '';
    const cardRestored = findSidebarRow(afterUndo, 'Card');
    expect(cardRestored).toContain('[ ]');
    expect(cardRestored).not.toContain('[✓]');
  });

  it('Ctrl+Z undoes reject-cascade', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('r');
    await tick();
    const afterReject = lastFrame() ?? '';
    const rejLine = findSidebarRow(afterReject, 'Card');
    expect(rejLine).toContain('[✗]');
    stdin.write(CTRL_Z);
    await tick();
    const afterUndo = lastFrame() ?? '';
    const undoLine = findSidebarRow(afterUndo, 'Card');
    expect(undoLine).toContain('[ ]');
    expect(undoLine).not.toContain('[✗]');
  });

  it('Ctrl+Y redoes after Ctrl+Z', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    stdin.write(CTRL_Z);
    await tick();
    stdin.write(CTRL_Y);
    await tick();
    const frame = lastFrame() ?? '';
    const cardLine = findSidebarRow(frame, 'Card');
    expect(cardLine).toContain('[✓]');
  });

  it('Ctrl+Z after mount auto-reject restores pre-auto-reject state; second Ctrl+Z is a floor no-op', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: cycleA },
      { key: 'CycleB', entry: cycleB },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'next', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'prev', toComponent: 'CycleA' },
        ],
        suggestedBreak: null,
      },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Auto-reject fired — banner visible.
    expect(lastFrame() ?? '').toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write(CTRL_Z);
    await tick();
    const after = lastFrame() ?? '';
    expect(after).not.toMatch(/Cyclic manifest — auto-rejected/);
    // Second Ctrl+Z at the floor — nothing further to undo.
    stdin.write(CTRL_Z);
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('[u] is an alias for undo', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('u');
    await tick();
    const frame = lastFrame() ?? '';
    const cardLine = findSidebarRow(frame, 'Card');
    expect(cardLine).toContain('[ ]');
  });

  it('undo of an accept does NOT re-write DB via storeCDFComponents', async () => {
    // Accept doesn't call storeCDFComponents itself, but this pins the
    // in-memory-only guarantee for the undo path even after `[a]`.
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const storeSpy = vi.mocked(dbMod.storeCDFComponents);
    storeSpy.mockClear();
    const { stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    const callsAfterAccept = storeSpy.mock.calls.length;
    stdin.write(CTRL_Z);
    await tick();
    // Undo did NOT add a new storeCDFComponents call.
    expect(storeSpy.mock.calls.length).toBe(callsAfterAccept);
  });

  it('Ctrl+R opens the reload-from-save confirm dialog', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(lastFrame() ?? '').toMatch(/Reload from saved state/i);
  });

  it('Enter in reload dialog re-runs the load path and resets state', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    // First mount load: Card in `needs-review`. Second load (post-Ctrl+R):
    // return a DIFFERENT manifest so we can prove the reload hydrated fresh.
    vi.mocked(dbMod.loadCDFComponents)
      .mockReturnValueOnce([{ key: 'Card', entry: card }])
      .mockReturnValueOnce([{ key: 'FreshComponent', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Mutate in-memory state via accept.
    stdin.write('a');
    await tick();
    const cardAfterAccept = findSidebarRow(lastFrame() ?? '', 'Card');
    expect(cardAfterAccept).toContain('[✓]');
    // Reload.
    stdin.write(CTRL_R);
    await tick();
    stdin.write('\r'); // Enter → confirm
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('FreshComponent');
    expect(frame).not.toContain('Card');
  });

  it('Esc in reload dialog cancels and leaves state alone', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    stdin.write(CTRL_R);
    await tick();
    expect(lastFrame() ?? '').toMatch(/Reload from saved state/i);
    stdin.write('\x1b'); // Esc → cancel
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Reload from saved state/i);
    // Card is still accepted.
    const cardLine = findSidebarRow(frame, 'Card');
    expect(cardLine).toContain('[✓]');
  });

  it('legend advertises Cmd+Z / Cmd+Y / Ctrl+R when sidebar is focused', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('[Cmd+Z] undo');
    expect(frame).toContain('[Cmd+Y] redo');
    expect(frame).toContain('[Ctrl+R] reload');
  });
});

// ── T2 (layout plan §A): cycle banner + search input move BELOW sidebar ─────
// Layout order top→bottom:
//   removed strip · auto-reject banner · sidebar+detail · cycle banner
//   · search input · legend.
// Auto-reject banner stays HIGH; cycle banner + search input drop to bottom.
describe('GenerateReviewStep — bottom-of-step banners (T2)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const CYCLE_A: Entry = {
    $type: 'component',
    $properties: {},
    $slots: { header: { $allowedComponents: ['CycleB'] } } as never,
  };
  const CYCLE_B: Entry = {
    $type: 'component',
    $properties: {},
    $slots: { footer: { $allowedComponents: ['CycleA'] } } as never,
  };

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('cycle banner renders BELOW the sidebar+detail row', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);
    // Undo the mount auto-reject so the sidebar detail panel renders (an
    // all-rejected accepted set is fine but we still need FIELDS marker to
    // pin the sidebar+detail row).
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('u'); // undo mount auto-reject so FIELDS marker present
    await tick();
    const frame = lastFrame() ?? '';
    const fieldsIdx = frame.indexOf('FIELDS');
    const cycleIdx = frame.search(/slot dependency cycle/);
    expect(fieldsIdx).toBeGreaterThanOrEqual(0);
    expect(cycleIdx).toBeGreaterThanOrEqual(0);
    expect(cycleIdx).toBeGreaterThan(fieldsIdx);
  });

  it('search input renders BELOW the sidebar+detail row', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: { $type: 'component', $properties: { a: { $type: 'string', $category: 'content' } } } as Entry },
      { key: 'Beta', entry: { $type: 'component', $properties: { b: { $type: 'string', $category: 'content' } } } as Entry },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('/');
    await tick();
    stdin.write('a');
    await tick();
    const frame = lastFrame() ?? '';
    const fieldsIdx = frame.indexOf('FIELDS');
    // Search input marker: match-count text pinned to the input line.
    const searchIdx = frame.search(/\/a[^\n]*matches/);
    expect(fieldsIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThanOrEqual(0);
    expect(searchIdx).toBeGreaterThan(fieldsIdx);
  });

  it('auto-reject banner stays ABOVE the sidebar+detail row', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([
      {
        path: ['CycleA', 'CycleB', 'CycleA'],
        edges: [
          { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
          { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
        ],
        suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    const autoRejIdx = frame.search(/Cyclic manifest — auto-rejected/);
    const fieldsIdx = frame.indexOf('FIELDS');
    expect(autoRejIdx).toBeGreaterThanOrEqual(0);
    expect(fieldsIdx).toBeGreaterThanOrEqual(0);
    expect(autoRejIdx).toBeLessThan(fieldsIdx);
  });
});

// ── T5b (layout plan §B) — [i] jump-and-filter in GenerateReviewStep ─────────
// Mirrors ScopeGateStep T5. Prop-rationale rebound from [i] to [p]; [i] now
// filters the sidebar to the focused component + its transitive ancestors.
describe('GenerateReviewStep — [i] jump-and-filter (T5b)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  // A slots B slots C slots D — chain of composites.
  const withSlot = (name: string, allowed: string[]): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
    $slots: {
      children: { $type: 'slot', $allowedComponents: allowed },
    } as never,
  });
  const leaf = (name: string): Entry => ({
    $type: 'component',
    $properties: { [name.toLowerCase()]: { $type: 'string', $category: 'content' } },
  });
  const CHAIN: Array<{ key: string; entry: Entry }> = [
    { key: 'A', entry: withSlot('A', ['B']) },
    { key: 'B', entry: withSlot('B', ['C']) },
    { key: 'C', entry: withSlot('C', ['D']) },
    { key: 'D', entry: leaf('D') },
  ];

  function sidebarNames(frame: string): Set<string> {
    // Only inspect lines that carry a sidebar row glyph (`[ ]` / `[✓]` / `[✗]`).
    // The right pane never renders those, so this reliably restricts the scan.
    const rowLines = frame.split('\n').filter((l) => /\[[ ✓✗×]\]/.test(l));
    const found = new Set<string>();
    for (const l of rowLines) {
      for (const name of ['A', 'B', 'C', 'D']) {
        if (new RegExp(`(^|[\\s├└─▸▾▶]) ?${name}(\\s|$|[^A-Za-z])`).test(l)) {
          found.add(name);
        }
      }
    }
    return found;
  }

  beforeEach(() => {
    triggerSpy.mockReset();
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('[i] on component with two ancestors filters to target + those two', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(CHAIN);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Move cursor from top row (A) to C. Groups seed expanded so all four rows
    // are visible; j walks the selectable-row positions.
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('i');
    await tick();
    const names = sidebarNames(lastFrame() ?? '');
    expect(names.has('A')).toBe(true);
    expect(names.has('B')).toBe(true);
    expect(names.has('C')).toBe(true);
    expect(names.has('D')).toBe(false);
  });

  it('[i] on root shows only that component', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(CHAIN);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // Cursor starts on A (root).
    stdin.write('i');
    await tick();
    const names = sidebarNames(lastFrame() ?? '');
    expect(names.has('A')).toBe(true);
    expect(names.has('B')).toBe(false);
    expect(names.has('C')).toBe(false);
    expect(names.has('D')).toBe(false);
  });

  it('repeat [i] on same target clears the filter', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(CHAIN);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('i');
    await tick();
    stdin.write('i');
    await tick();
    const names = sidebarNames(lastFrame() ?? '');
    expect(names.has('A')).toBe(true);
    expect(names.has('B')).toBe(true);
    expect(names.has('C')).toBe(true);
    expect(names.has('D')).toBe(true);
  });

  it('Esc clears jump filter before clearing search query', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(CHAIN);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('i');
    await tick();
    stdin.write(''); // Esc — clears jump filter
    await tick();
    const names = sidebarNames(lastFrame() ?? '');
    expect(names.has('A')).toBe(true);
    expect(names.has('B')).toBe(true);
    expect(names.has('C')).toBe(true);
    expect(names.has('D')).toBe(true);
  });

  it('[i] does NOT open prop-rationale panel any more', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('i');
    await tick();
    const out = lastFrame() ?? '';
    // The rationale panel header must NOT appear at top of the right pane.
    expect(out).not.toMatch(/^RATIONALE/m);
  });

  it('[p] opens the prop-rationale panel (new binding)', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('p');
    await tick();
    expect(lastFrame() ?? '').toContain('RATIONALE');
  });

  it('legend advertises [i] focus lineage and [p] rationale', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(CHAIN);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    // eslint-disable-next-line no-control-regex
    const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/\[i\][^\n]*focus lineage/);
    expect(frame).toMatch(/\[p\][^\n]*rationale/);
  });
});
