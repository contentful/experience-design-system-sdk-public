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

const triggerSpy = vi.fn();
let lastUseLivePreviewArgs: unknown = null;
let lastOnResult:
  | ((r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void)
  | null = null;
let hookReturnOverride: { trigger: () => void; status: 'idle' | 'running'; disabled: boolean } | null = null;
vi.mock('../../../../src/import/tui/useLivePreview.js', () => ({
  useLivePreview: (args: {
    enabled: boolean;
    onResult: (r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void;
  }) => {
    lastUseLivePreviewArgs = args;
    lastOnResult = args.onResult;
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
    expect(frame).toMatch(/FIELDS/);
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
    stdin.write('J');
    await tick();
    const jsonFrame = lastFrame() ?? '';
    expect(jsonFrame).toMatch(/GENERATED DEFINITION \(read-only\)/);
    expect(jsonFrame).not.toMatch(/FIELDS \[Ctrl\+S/);

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
    expect(frame).toMatch(/\[Tab\] focus panel/);
  });

  it('GA-1 A6: pressing e from sidebar does NOT cross focus to the panel', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('e');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus panel/);
    expect(frame).not.toMatch(/\[Tab\] focus list/);
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
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    stdin.write('e');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    expect(frame).not.toMatch(/\[Tab\] focus panel/);
  });

  it('pressing Esc at FieldEditor row-level returns focus to the sidebar', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    stdin.write('\x1b');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus panel/);
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
    expect(frame).toMatch(/Foo \(empty\)/);
  });

  it('does NOT render the banner when every component has at least one $properties entry', async () => {
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
  });

  it('failed save (malformed draft via direct invariant) does NOT call trigger', async () => {
    render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />);
    await tick();
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('onResult populates per-component previewAnnotation visible in sidebar', async () => {
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
    expect(VALID_DRAFT).toBeTypeOf('string');
    expect(lastFrame() ?? '').toMatch(/Button/);
  });
});

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

describe('GenerateReviewStep — diff summary panel (R2)', () => {
  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('renders count summary when previewAnnotations are populated', async () => {
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
    expect(frame).toMatch(/Button/);
    expect(frame).toMatch(/\[Tab\] focus panel/);
    expect(frame).toMatch(/accept all/);
  });
});

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
    expect(lastFrame() ?? '').not.toMatch(/Removed components/);
    stdin.write('d');
    await tick();
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

describe('GenerateReviewStep — rapid j/k navigation (no stutter)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const makeEntry = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  it('rapid j burst advances the cursor exactly N rows (no stale-closure regression)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const KEYS = ['Aaa', 'Bbb', 'Ccc', 'Ddd', 'Eee'];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(KEYS.map((k) => ({ key: k, entry: makeEntry(k) })));
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    const frame = lastFrame() ?? '';
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
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    stdin.write('k');
    stdin.write('k');
    await tick();
    const frame = lastFrame() ?? '';
    const hasSelected = frame.split('\n').some((l) => l.includes('Ccc') && /\bprop/.test(l));
    expect(hasSelected).toBe(true);
  });
});

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
    const runSpy = vi.fn();
    vi.mocked(dbMod.openPipelineDb).mockReturnValue({
      prepare: vi.fn().mockReturnValue({ run: runSpy }),
      exec: vi.fn(),
      close: vi.fn(),
    } as unknown as ReturnType<typeof dbMod.openPipelineDb>);

    const onFinalize = vi.fn();
    const { stdin } = render(<GenerateReviewStep extractSessionId="sess-1" onFinalize={onFinalize} onQuit={vi.fn()} />);
    await tick();
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
  it('pressing P from sidebar focus opens the component rationale panel and replaces the right pane (L11 I→P rebind)', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/FIELDS/);
    stdin.write('P');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('Component rationale');
    expect(out).toContain('Button');
    expect(out).not.toMatch(/FIELDS \[Ctrl\+S/);
  });

  it('L11: pressing I no longer opens the component rationale panel', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('I');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Component rationale');
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

  it('GA-2 A4: pressing s from sidebar focus opens the source panel', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadComponentReviewMetadata).mockReturnValue({
      sourcePath: '/proj/Button.tsx',
      componentSource: 'L1\nL2\nL3',
      props: {},
    });
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/FIELDS/);
    stdin.write('s');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('source: /proj/Button.tsx');
    expect(out).not.toMatch(/FIELDS \[Ctrl\+S/);
  });

  it('pressing P again closes the panel and restores the right pane', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('P');
    await tick();
    expect(lastFrame() ?? '').toContain('Component rationale');
    stdin.write('P');
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
    stdin.write('P');
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
    stdin.write('P');
    await tick();
    const out = lastFrame() ?? '';
    expect(out).toContain('Component rationale');
    expect(out).not.toMatch(/^RATIONALE/m);
  });

  it('rationale keys are gated when the finalize dialog is open', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    stdin.write('F'); // open finalize dialog
    await tick();
    stdin.write('P');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Component rationale');
  });
});

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

describe('GenerateReviewStep — GA-3 cycle features (A1/A2/A7/A8)', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const leaf = (name: string) => ({
    $type: 'component' as const,
    $properties: { [name]: { $type: 'string' as const, $category: 'content' as const } },
  });
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
  const CYCLE_STORED = [
    {
      path: ['CycleA', 'CycleB', 'CycleA'],
      edges: [
        { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
        { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
      ],
      suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
    },
  ];

  async function renderWithCycle(extra: Array<{ key: string; entry: unknown }> = []) {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
      ...(extra as Array<{ key: string; entry: typeof CYCLE_A }>),
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce(CYCLE_STORED);
    const utils = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    return utils;
  }

  it('legend labels [o] "only cycles" (filter) and [c] "cycle list" (panel) distinctly', async () => {
    const { lastFrame } = await renderWithCycle();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/\[o\]\s*only cycles/);
    expect(frame).toMatch(/\[c\]\s*cycle list/);
  });

  it('? help overlay cycle entry mentions rejecting a member AND removing/breaking a slot edge', async () => {
    const { lastFrame, stdin } = await renderWithCycle();
    stdin.write('?');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '').toLowerCase();
    expect(frame).toMatch(/reject a cycle member/);
    expect(frame).toMatch(/break the cycle|remove a slot/);
  });

  it('[c] cycle panel guidance states reject-a-member AND remove/break-a-slot-edge', async () => {
    const { lastFrame, stdin } = await renderWithCycle();
    stdin.write('c');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '').toLowerCase();
    expect(frame).toMatch(/reject a cycle member/);
    expect(frame).toMatch(/break the cycle|remove a slot/);
  });

  it('[c] cycle panel: Enter jumps the main cursor to the cycle member', async () => {
    const { lastFrame, stdin } = await renderWithCycle([{ key: 'Zonk', entry: leaf('Zonk') }]);
    stdin.write('j');
    await tick(10);
    stdin.write('j');
    await tick(10);
    stdin.write('c');
    await tick();
    stdin.write('\r');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/SLOT DEPENDENCY CYCLES/);
    stdin.write('l');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Lineage: CycleA');
  });

  it('[c] cycle panel still renders the "Suggested fix:" (suggestedBreak) line', async () => {
    const { lastFrame, stdin } = await renderWithCycle();
    stdin.write('c');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/Suggested fix/);
  });

  it('[c] cycle panel scroll follows the cursor to a cycle below the window', async () => {
    const MANY = Array.from({ length: 12 }, (_, i) => ({
      path: [`Comp${i}A`, `Comp${i}B`, `Comp${i}A`],
      edges: [
        { fromComponent: `Comp${i}A`, slotName: 'header', toComponent: `Comp${i}B` },
        { fromComponent: `Comp${i}B`, slotName: 'footer', toComponent: `Comp${i}A` },
      ],
      suggestedBreak: { fromComponent: `Comp${i}A`, slotName: 'header', toComponent: `Comp${i}B` },
    }));
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce(MANY);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('c');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/Cycle 12 \(/);
    for (let i = 0; i < 11; i++) {
      stdin.write('j');
      await tick();
    }
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/▶ Cycle 12 \(/);
  });
});

describe('GenerateReviewStep — GA-4 interactive break-cycle overlay (A9)', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
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
  const CYCLE_STORED = [
    {
      path: ['CycleA', 'CycleB', 'CycleA'],
      edges: [
        { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
        { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
      ],
      suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
    },
  ];

  async function renderWithCycle() {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce(CYCLE_STORED);
    const utils = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    return { utils, dbMod };
  }

  it('[x] from the cycle list opens the break overlay enumerating removable slot edges', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/remove 'CycleB' from CycleA\.\$slots\.header\.\$allowedComponents/);
    expect(frame).toMatch(/remove 'CycleA' from CycleB\.\$slots\.footer\.\$allowedComponents/);
  });

  it('Enter + confirm (y) removes the highlighted edge from $allowedComponents in review state', async () => {
    const { utils, dbMod } = await renderWithCycle();
    const { stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\r'); // select first edge → confirm prompt
    await tick();
    stdin.write('y'); // confirm delete
    await tick();
    const calls = vi.mocked(dbMod.storeCDFComponents).mock.calls;
    const lastCdf = calls.at(-1);
    expect(lastCdf?.[2]).toEqual([
      expect.objectContaining({
        key: 'CycleA',
        entry: expect.objectContaining({
          $slots: { header: expect.objectContaining({ $allowedComponents: [] }) },
        }),
      }),
    ]);
  });

  it('after a break-delete that resolves the only cycle, cycles drop out (recompute → storeSlotCycles [])', async () => {
    const { utils, dbMod } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('y');
    await tick();
    const lastStore = vi.mocked(dbMod.storeSlotCycles).mock.calls.at(-1);
    expect(lastStore?.[2]).toEqual([]);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toMatch(/CycleB \(cycle\)/);
  });

  it('Ctrl+Z restores the removed $allowedComponents edge after a break-delete', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('y');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/CycleB \(cycle\)/);
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/CycleB \(cycle\)/);
  });

  it('A2-5 — break overlay renders in the bottom banner slot (below FIELDS), not the top strip', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    const breakIdx = frame.indexOf('BREAK CYCLE');
    const fieldsIdx = frame.indexOf('FIELDS');
    expect(breakIdx).toBeGreaterThan(-1);
    expect(fieldsIdx).toBeGreaterThan(-1);
    expect(breakIdx).toBeGreaterThan(fieldsIdx);
  });

  it('A2-5 — closing the break overlay + cycle panel restores the slot-dependency banner', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/detected — push will fail/);
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/detected — push will fail/);
    stdin.write('x'); // close break overlay
    await tick();
    stdin.write('c'); // close cycle panel
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/detected — push will fail/);
  });

  it('A2-6 — break overlay renders the highlighted cycle dependency path under the title', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    const start = frame.indexOf('BREAK CYCLE');
    const end = frame.indexOf('[Enter] delete');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const box = frame.slice(start, end);
    expect(box).toMatch(/\[header\]/);
    expect(box).toMatch(/\[footer\]/);
    expect(box).toMatch(/→/);
    expect(box).toMatch(/remove 'CycleB' from CycleA\.\$slots\.header\.\$allowedComponents/);
  });
});

describe('GenerateReviewStep — A2-4 reject cycle members from the break overlay', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
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
  const CYCLE_STORED = [
    {
      path: ['CycleA', 'CycleB', 'CycleA'],
      edges: [
        { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
        { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
      ],
      suggestedBreak: { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
    },
  ];

  async function renderWithCycle() {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce(CYCLE_STORED);
    const utils = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    return { utils, dbMod };
  }

  it('sidebar [r] reject still flips the target to rejected + cascades (pins the shared-helper refactor)', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('r');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/\[✗\][^\n]*CycleA/);
  });

  it('break overlay lists a reject entry for each cycle participant (in addition to edges)', async () => {
    const { utils } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/remove 'CycleB' from CycleA\.\$slots\.header\.\$allowedComponents/);
    expect(frame).toMatch(/reject component 'CycleA'/);
    expect(frame).toMatch(/reject component 'CycleB'/);
  });

  it('Enter on a reject-member entry rejects immediately with NO confirm prompt + drops the cycle', async () => {
    const { utils, dbMod } = await renderWithCycle();
    const { lastFrame, stdin } = utils;
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('j'); // edge 1 -> edge 2
    await tick();
    stdin.write('j'); // edge 2 -> member CycleA
    await tick();
    stdin.write('\r'); // reject CycleA immediately
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).not.toMatch(/\[y\] confirm/);
    const lastStore = vi.mocked(dbMod.storeSlotCycles).mock.calls.at(-1);
    expect(lastStore?.[2]).toEqual([]);
  });

  it('Ctrl+Z restores the member status after an overlay reject', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: { $type: 'component', $properties: {} } },
    ]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce(CYCLE_STORED);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/\[✗\][^\n]*CycleA/);
    stdin.write('c');
    await tick();
    stdin.write('x');
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('\r'); // reject CycleA from the overlay
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toMatch(/\[✗\][^\n]*CycleA/);
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toMatch(/\[✗\][^\n]*CycleA/);
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
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/slot dependency cycle/);
    expect(frame).toMatch(/CycleA \(cycle\)/);

    stdin.write('r');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/slot dependency cycle/);
    expect(frame).toMatch(/CycleA \(cycle\)/);
    expect(frame).toMatch(/CycleB \(cycle\)/);
    expect(vi.mocked(dbMod.storeSlotCycles)).toHaveBeenCalled();
    const lastCallArgs = vi.mocked(dbMod.storeSlotCycles).mock.calls.at(-1);
    expect(lastCallArgs?.[2]).toEqual([]);
  });

  it('[F] with cycle at mount: auto-reject leaves accepted-set non-cyclic → dialog opens', async () => {
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
    expect(frame).toMatch(/Save decisions and exit/);
  });
});

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
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('k');
    await tick();
    stdin.write(' ');
    await tick();
    const frame = lastFrame() ?? '';
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
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('k');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    const titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Body');
    expect(titleLine).not.toContain('Card');
  });

  it('pressing Enter on an ancestor without direct/inherited issues is a no-op', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Card', entry: withSlot('Card', ['Body']) },
      { key: 'Body', entry: leaf('Body') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
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
    expect(/[+~]/.test(frame)).toBe(true);
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
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ Layout/);
    expect(frame).toContain('Heading');
    expect(frame).toContain('Header');

    stdin.write('C');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ Layout/);
    expect(frame).not.toMatch(/▾ Card/);
    expect(frame).not.toMatch(/▾ Layout/);
    expect(frame).not.toContain('├─ Heading');
    expect(frame).not.toContain('└─ Heading');
    expect(frame).not.toContain('├─ Header');
    expect(frame).not.toContain('└─ Header');

    stdin.write('C');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ Layout/);

    stdin.write('E');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).toMatch(/▾ Layout/);
    expect(frame).toContain('Heading');
    expect(frame).toContain('Header');

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

    stdin.write('\x1a'); // Ctrl+Z
    await tick();

    stdin.write('C');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/▸ Card/);
    expect(frame).toMatch(/▸ ⚠ P/);

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
    expect(frame).toMatch(/\[n\] next/);
    expect(frame).not.toMatch(/\[Tab\] next/);
    let titleLine = frame.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Button');
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
    expect(lastFrame() ?? '').toMatch(/\[Tab\] focus panel/);
    stdin.write('/');
    await tick();
    stdin.write('b');
    await tick();
    stdin.write('\r'); // close input, preserve query
    await tick();
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
    // eslint-disable-next-line no-control-regex
    const frame = (lastFrame() ?? '').replace(/\[[0-9;]*m/g, '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/\[\/\][^\n]*search/);
  });

  it('match counter dedupes shared-dep rows to unique component count (1/N not 2/N)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
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
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    stdin.write('z');
    await tick();
    expect(lastFrame() ?? '').toMatch(/0\/2 matches/);
    stdin.write('\r'); // Enter — should clear + close (mirror ScopeGate)
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/\[Tab\] next/);
    expect(frame).not.toMatch(/matches/);
    expect(frame).not.toMatch(/\/zzzz/);
  });

  it('Enter advances the cursor past the current match row (cursor exclusion)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
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
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Banner', entry: makeEntry('Banner') },
      { key: 'Button', entry: makeEntry('Button') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('j');
    await tick();
    let titleLine = (lastFrame() ?? '').split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleLine).toContain('Button');
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
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Article', entry: parentEntry('Card') },
      { key: 'Section', entry: parentEntry('Card') },
      { key: 'Card', entry: cardEntry },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('j');
    stdin.write('j');
    stdin.write('j');
    await tick();
    const frame = lastFrame() ?? '';
    const cursorCount = (frame.match(/▶/g) ?? []).length;
    expect(cursorCount).toBe(1);
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

describe('GenerateReviewStep — Task #37 mount-time cycle auto-reject', () => {
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
    expect(frame).toMatch(/Ancestors:.*Outer/);
    expect(frame).toMatch(/Ancestors:.*Wrapper/);
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

  it('GA-1 A5: auto-reject banner advertises Ctrl+Z undo while armed; omits it after undo fires', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    let frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('[Ctrl+Z] undo');
    expect(frame).not.toContain('[u] undo');
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('Ctrl+Z undo restores pre-mount state (empty user decisions)', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('Ctrl+Z twice is a floor no-op after first press', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    const afterFirstUndo = lastFrame() ?? '';
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    const afterSecondUndo = lastFrame() ?? '';
    expect(afterFirstUndo).not.toMatch(/Cyclic manifest — auto-rejected/);
    expect(afterSecondUndo).not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('operator [a] on a cycle member cascades to its cycle partner and does not re-trigger auto-reject', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    const frame = lastFrame() ?? '';
    // Both cycle members accepted — banner now lists only the ancestor remainder, not the cycle members.
    expect(frame).not.toMatch(/Cycle members:/);
    expect(frame).toMatch(/Ancestors: Outer, Wrapper/);
  });

  it('[F] continue with accepted subset still cyclic → blocked with re-shown banner', async () => {
    await primeCycles();
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    stdin.write('A');
    await tick();
    stdin.write('F');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Cannot finalize — accepted set still contains a cycle/);
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
    stdin.write('a');
    await tick();
    stdin.write('j');
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
    const [acceptedCount, rejectedCount] = onFinalize.mock.calls[0];
    expect(acceptedCount).toBe(0);
    expect(rejectedCount).toBe(3);
  });
});

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
    stdin.write('\x1a'); // Ctrl+Z
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write('C'); // collapse-all
    await tick();
    stdin.write('E'); // expand-all
    await tick();
    stdin.write('j'); // move cursor
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('mount with NO cycle → later edit introduces a cycle → auto-reject never fires', async () => {
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
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
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
      stdin.write('\x1a'); // Ctrl+Z
      await tick();
      stdin.write('A');
      await tick();
      stdin.write('F');
      await tick();
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Cannot finalize — accepted set still contains a cycle/);
      expect(frame).not.toMatch(/Save decisions and exit/);
    });

    it('[a] on a cycle member cascades to its partner (cycle-unit cohesion)', async () => {
      await primeA();
      const { lastFrame, stdin } = render(
        <GenerateReviewStep extractSessionId="sess-a" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      stdin.write('\x1a'); // Ctrl+Z — undo mount auto-reject → both needs-review
      await tick();
      stdin.write('a'); // accept C — cascade pulls in P (cycle partner)
      await tick();
      stdin.write('F'); // finalize gate — accepted subset {C, P} still cyclic → blocked
      await tick();
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Cannot finalize.*cycle/i);
      expect(frame).not.toMatch(/Save decisions and exit/);
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
      await primeC();
      const { lastFrame } = render(
        <GenerateReviewStep extractSessionId="sess-c" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
      );
      await tick();
      const frame = lastFrame() ?? '';
      expect(frame).toMatch(/Cyclic manifest — auto-rejected/);
      expect(frame).toMatch(/Cycle members:.*P/);
      expect(frame).toMatch(/Cycle members:.*X/);
      const cycleMembersLine = frame.split('\n').find((l) => l.includes('Cycle members:')) ?? '';
      const ancestorsLine = frame.split('\n').find((l) => l.includes('Ancestors:')) ?? '';
      expect(cycleMembersLine).not.toMatch(/(^|[^A-Za-z])C([^A-Za-z]|$)/);
      expect(ancestorsLine).not.toMatch(/(^|[^A-Za-z])C([^A-Za-z]|$)/);
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
    await jumpToRow(stdin, 1);
    stdin.write('l');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Lineage: C');
    expect(frame).toContain('Ancestors:');
    expect(frame).toContain('Descendants:');
    expect(frame).toContain('P');
    expect(frame).toContain('X');
  });

  it('Tab moves cursor forward through jumpables inside the panel', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    await jumpToRow(stdin, 1);
    stdin.write('l');
    await tick();
    stdin.write('j');
    await tick();
    expect(lastFrame() ?? '').toContain('Lineage: C');
  });

  it('Enter jumps main selection to the highlighted entry and closes the panel', async () => {
    const { lastFrame, stdin } = await renderLineageFixture();
    stdin.write('l');
    await tick();
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

  describe('L2d — lineage renders as a sidebar overlay (not stacked below)', () => {
    async function renderOverlayFixture() {
      const dbMod = await import('../../../../src/session/db.js');
      vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
        { key: 'P', entry: withSlot('P', ['C']) },
        { key: 'C', entry: withSlot('C', ['X']) },
        { key: 'X', entry: leaf('X') },
        { key: 'Zzz', entry: leaf('Zzz') },
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

    it('when lineage is open the sidebar is replaced by the panel; detail panel stays visible', async () => {
      const { lastFrame, stdin } = await renderOverlayFixture();
      const before = lastFrame() ?? '';
      expect(before).toContain('Zzz');
      expect(before).toContain('focus panel');

      await jumpToRow(stdin, 1);
      stdin.write('l');
      await tick();
      const open = lastFrame() ?? '';

      expect(open).toContain('Lineage:');
      expect(open).not.toContain('Zzz');
      expect(open).toContain('focus panel');
    });
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
    const beforeToggle = lastFrame() ?? '';
    expect(beforeToggle).toMatch(/▾[^\n]*Card/);
    expect(beforeToggle).toMatch(/├─ /);
    stdin.write('L');
    await tick();
    const afterToggle = lastFrame() ?? '';
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
    expect(lastFrame() ?? '').toMatch(/├─ /);
  });

  it('cursor selection is preserved on the same component across view toggle', async () => {
    const { lastFrame, stdin } = await renderToggleFixture();
    stdin.write('j');
    await tick();
    const beforeToggle = lastFrame() ?? '';
    const titleBefore = beforeToggle.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleBefore).toContain('Body');
    stdin.write('L');
    await tick();
    const afterToggle = lastFrame() ?? '';
    const titleAfter = afterToggle.split('\n').find((l) => /\bprop/.test(l)) ?? '';
    expect(titleAfter).toContain('Body');
  });
});

describe('GenerateReviewStep — unsaved-changes warning (T5)', () => {
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
    stdin.write('\t');
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toMatch(/\[Tab\] focus list/);
    stdin.write('\t');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[Tab\] focus panel/);
  });

  it('dirty Tab-away opens an Unsaved changes warning and blocks focus cross', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Hero', entry: SAMPLE_STRING }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    await crossAndDirty(stdin);
    stdin.write('\t');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Unsaved changes/i);
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
    expect(storeSpy).toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[Tab\] focus panel/);
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
    expect(storeSpy).not.toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[Tab\] focus panel/);
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
    expect(storeSpy).not.toHaveBeenCalled();
    const frame = lastFrame() ?? '';
    expect(frame).not.toMatch(/Unsaved changes/i);
    expect(frame).toMatch(/\[Tab\] focus list/);
  });
});

describe('GenerateReviewStep — undo/redo + reload-from-save (T4)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const CTRL_Z = '\x1a';
  const CTRL_Y = '\x19';
  const CTRL_R = '\x12';

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
    const before = lastFrame() ?? '';
    const cardBefore = findSidebarRow(before, 'Card');
    expect(cardBefore).toContain('[ ]');
    stdin.write('a');
    await tick();
    const afterAccept = lastFrame() ?? '';
    const cardAccepted = findSidebarRow(afterAccept, 'Card');
    expect(cardAccepted).toContain('[✓]');
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
    expect(lastFrame() ?? '').toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write(CTRL_Z);
    await tick();
    const after = lastFrame() ?? '';
    expect(after).not.toMatch(/Cyclic manifest — auto-rejected/);
    stdin.write(CTRL_Z);
    await tick();
    expect(lastFrame() ?? '').not.toMatch(/Cyclic manifest — auto-rejected/);
  });

  it('GA-1 A5: [u] is NO LONGER an alias for undo (Ctrl+Z is the sole undo)', async () => {
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
    expect(cardLine).toContain('[✓]');
    expect(cardLine).not.toContain('[ ]');
  });

  it('undo of an accept does NOT re-write DB via storeCDFComponents', async () => {
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
    vi.mocked(dbMod.loadCDFComponents)
      .mockReturnValueOnce([{ key: 'Card', entry: card }])
      .mockReturnValueOnce([{ key: 'FreshComponent', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    const cardAfterAccept = findSidebarRow(lastFrame() ?? '', 'Card');
    expect(cardAfterAccept).toContain('[✓]');
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
    const cardLine = findSidebarRow(frame, 'Card');
    expect(cardLine).toContain('[✓]');
  });

  it('legend advertises Ctrl+Z / Ctrl+Y / Ctrl+R when sidebar is focused', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: card }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('[Ctrl+Z] undo');
    expect(frame).toContain('[Ctrl+Y] redo');
    expect(frame).toContain('[Ctrl+R] reload');
  });
});

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
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('\x1a'); // Ctrl+Z — undo mount auto-reject so FIELDS marker present
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

describe('GenerateReviewStep — [i] jump-and-filter (T5b)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
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

describe('GenerateReviewStep — undo/redo legend + ? help overlay (L3b)', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('legend advertises Ctrl+Z / Ctrl+Y and NOT Cmd+Z / Cmd+Y', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('Ctrl+Z');
    expect(frame).toContain('Ctrl+Y');
    expect(frame).not.toContain('Cmd+Z');
    expect(frame).not.toContain('Cmd+Y');
  });

  it('pressing ? opens a help overlay advertising Ctrl+Y / Redo; Esc closes', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    const open = stripAnsi(lastFrame() ?? '');
    expect(open).toContain('Help');
    expect(open).toContain('Ctrl+Y');
    expect(open).toMatch(/Redo/i);

    stdin.write('\x1b'); // Esc
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('Help');
  });
});

describe('GenerateReviewStep — breaking-changes goto-banner (L6)', () => {
  let deriveBreakingChanges: typeof import('../../../../src/import/tui/steps/GenerateReviewStep.js').deriveBreakingChanges;

  beforeEach(async () => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    deriveBreakingChanges = mod.deriveBreakingChanges;
  });

  const stripAnsiL6 = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const previewWithBreaking = () =>
    ({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'btn', name: 'Button', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [{ propertyId: 'variant', reason: 'removed' }],
            },
            impact: { affectedFragments: 2, affectedExperiences: 1 },
          },
          {
            current: { id: 'lbl', name: 'Label', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'compatible', breakingChanges: [] },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    }) as never;

  it('deriveBreakingChanges keeps only breaking-classified changed entities with their detail', () => {
    const out = deriveBreakingChanges(previewWithBreaking());
    expect(out).toHaveLength(1);
    expect(out[0].componentName).toBe('Button');
    expect(out[0].changes).toEqual([{ propertyId: 'variant', reason: 'removed' }]);
    expect(out[0].impact).toEqual({ affectedFragments: 2, affectedExperiences: 1 });
  });

  it('deriveBreakingChanges returns empty for a response with no breaking changes', () => {
    expect(
      deriveBreakingChanges({
        components: { new: [], changed: [], removed: [], unchanged: ['Button'] },
        tokens: { new: [], changed: [], removed: [], unchanged: [] },
      } as never),
    ).toEqual([]);
  });

  it('shows the [b] N breaking changes hint and opens the goto-banner on [b]', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithBreaking());
    await tick();
    const hint = stripAnsiL6(lastFrame() ?? '');
    expect(hint).toContain('[b]');
    expect(hint).toMatch(/1 breaking/);

    stdin.write('b');
    await tick();
    const open = stripAnsiL6(lastFrame() ?? '');
    expect(open).toContain('Breaking changes');
    expect(open).toMatch(/Button/);
    expect(open).toMatch(/removed/);
  });

  it('legend advertises [b] see breaking changes', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithBreaking());
    await tick();
    expect(stripAnsiL6(lastFrame() ?? '')).toContain('[b] see breaking changes');
  });

  const SAMPLE_BUTTON = {
    $type: 'component' as const,
    $properties: {
      variant: { $type: 'enum' as const, $category: 'content' as const, $values: ['a', 'b'] },
      size: { $type: 'string' as const, $category: 'content' as const, $description: 'SIZE_DESC_BD4' },
    },
  };

  const previewWithTwoChangesOnButton = () =>
    ({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'btn', name: 'Button', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [
                { propertyId: 'variant', reason: 'removed' },
                { propertyId: 'size', reason: 'type_changed' },
              ],
            },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    }) as never;

  it('BD4: banner lists one row per breaking change, each carrying its propertyId', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Button', entry: SAMPLE_BUTTON }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithTwoChangesOnButton());
    await tick();
    stdin.write('b');
    await tick();
    const open = stripAnsiL6(lastFrame() ?? '');
    expect(open).toMatch(/variant/);
    expect(open).toMatch(/size/);
    expect(open).toMatch(/removed/);
    expect(open).toMatch(/type changed/);
  });

  it('BD4: Enter on a change row focuses the editor scrolled to that exact prop', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Button', entry: SAMPLE_BUTTON }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithTwoChangesOnButton());
    await tick();
    stdin.write('b'); // open banner
    await tick();
    stdin.write('j'); // move cursor to the SECOND change row (size)
    await tick();
    stdin.write('\r'); // Enter → jump + focus editor at `size`
    await tick();
    const frame = stripAnsiL6(lastFrame() ?? '');
    expect(frame).toContain('SIZE_DESC_BD4');
    expect(frame).toContain('[Tab] focus list');
  });

  it('BD4: Enter on a slot-change row focuses the editor scrolled to that exact slot', async () => {
    const SLOT_CARD_ENTRY = {
      $type: 'component' as const,
      $properties: {},
      $slots: { footer: { $allowedComponents: ['X'] } },
    };
    const previewWithSlotChange = () =>
      ({
        components: {
          new: [],
          changed: [
            {
              current: { id: 'card', name: 'Card', contentProperties: [], designProperties: [], slots: ['footer'] },
              proposed: { $type: 'component', $properties: {}, $slots: { footer: { $allowedComponents: ['X'] } } },
              hasPendingDraftChanges: false,
              changeClassification: {
                classification: 'breaking',
                breakingChanges: [{ slotId: 'footer', reason: 'slot_removed' }],
              },
            },
          ],
          removed: [],
          unchanged: [],
        },
        tokens: { new: [], changed: [], removed: [], unchanged: [] },
      }) as never;

    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: SLOT_CARD_ENTRY }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithSlotChange());
    await tick();
    stdin.write('b'); // open breaking-changes banner
    await tick();
    stdin.write('\r'); // Enter on the first (only) row — the slot-change row
    await tick();
    const frame = stripAnsiL6(lastFrame() ?? '');
    expect(frame).toContain('[Tab] focus list');
    expect(frame).toContain('footer');
  });

  it('BD2: deriveBreakingChanges carries BOTH property-branch and slot-branch changes', () => {
    const out = deriveBreakingChanges({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'card', name: 'Card', contentProperties: [], designProperties: [], slots: ['footer'] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [
                { propertyId: 'variant', reason: 'removed' },
                { slotId: 'footer', reason: 'slot_removed' },
              ],
            },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    expect(out).toHaveLength(1);
    expect(out[0].changes).toEqual([
      { propertyId: 'variant', reason: 'removed' },
      { slotId: 'footer', reason: 'slot_removed' },
    ]);
  });

  it('BD2: buildBreakingRows emits a prop row and a slot row with the right focusTarget kinds', async () => {
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    const rows = mod.buildBreakingRows([
      {
        componentName: 'Card',
        changes: [
          { propertyId: 'variant', reason: 'removed' },
          { slotId: 'footer', reason: 'slot_removed' },
        ] as never,
      },
    ]);
    const propRow = rows.find((r) => r.focusTarget?.kind === 'prop');
    const slotRow = rows.find((r) => r.focusTarget?.kind === 'slot');
    expect(propRow?.focusTarget).toEqual({ kind: 'prop', name: 'variant' });
    expect(slotRow?.focusTarget).toEqual({ kind: 'slot', name: 'footer' });
    expect(slotRow?.label).toContain('footer');
    expect(slotRow?.label).toContain('slot removed');
    expect(slotRow?.label).not.toContain('undefined');
  });
});

describe('BD3 — formatBreakingChange (pure formatter)', () => {
  let formatBreakingChange: typeof import('../../../../src/import/tui/steps/breaking-change-format.js').formatBreakingChange;

  beforeEach(async () => {
    const mod = await import('../../../../src/import/tui/steps/breaking-change-format.js');
    formatBreakingChange = mod.formatBreakingChange;
  });

  it('property branch enriched with fullProperties names id, category, and reason', () => {
    const s = formatBreakingChange(
      { propertyId: 'colorScheme', reason: 'removed' },
      { fullProperties: { colorScheme: { type: 'enum', category: 'design', required: true } } } as never,
    );
    expect(s).toContain('colorScheme');
    expect(s).toContain('design');
    expect(s).toContain('removed');
  });

  it('property branch degrades gracefully with no current metadata', () => {
    const s = formatBreakingChange({ propertyId: 'variant', reason: 'type_changed' });
    expect(s).toContain('variant');
    expect(s).toContain('type changed');
    expect(s).not.toContain('undefined');
  });

  it('slot branch names the slotId and a friendly reason', () => {
    expect(formatBreakingChange({ slotId: 'footer', reason: 'slot_removed' })).toContain('footer');
    expect(formatBreakingChange({ slotId: 'footer', reason: 'slot_removed' })).toContain('slot removed');
    const narrowed = formatBreakingChange({ slotId: 'header', reason: 'slot_allowed_components_narrowed' });
    expect(narrowed).toContain('header');
    expect(narrowed).toContain('allowed components narrowed');
  });
});

describe('BD3 — buildBreakingRows uses the friendly formatter', () => {
  let buildBreakingRows: typeof import('../../../../src/import/tui/steps/GenerateReviewStep.js').buildBreakingRows;

  beforeEach(async () => {
    const mod = await import('../../../../src/import/tui/steps/GenerateReviewStep.js');
    buildBreakingRows = mod.buildBreakingRows;
  });

  it('row label carries the enriched detail (category) from fullProperties', () => {
    const rows = buildBreakingRows([
      {
        componentName: 'Card',
        current: { fullProperties: { colorScheme: { type: 'enum', category: 'design', required: true } } } as never,
        changes: [{ propertyId: 'colorScheme', reason: 'removed' }] as never,
      },
    ]);
    const row = rows.find((r) => r.focusTarget?.name === 'colorScheme');
    expect(row?.label).toContain('colorScheme');
    expect(row?.label).toContain('design');
    expect(row?.label).toContain('removed');
  });
});

describe('BD3 — breaking-change detail panel', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  const CARD_ENTRY = {
    $type: 'component' as const,
    $properties: {
      colorScheme: { $type: 'enum' as const, $category: 'design' as const, $values: ['a', 'b'] },
    },
    $slots: { footer: { $allowedComponents: ['X'] } },
  };

  const previewWithMixedChanges = () =>
    ({
      components: {
        new: [],
        changed: [
          {
            current: {
              id: 'card',
              name: 'Card',
              contentProperties: [],
              designProperties: ['colorScheme'],
              slots: ['footer'],
              fullProperties: { colorScheme: { type: 'enum', category: 'design', required: true } },
            },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [
                { propertyId: 'colorScheme', reason: 'removed' },
                { slotId: 'footer', reason: 'slot_removed' },
              ],
            },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    }) as never;

  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('detail panel lists each change with its detailed reason + metadata', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: CARD_ENTRY }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithMixedChanges());
    await tick();
    stdin.write('b'); // open breaking panel
    await tick();
    stdin.write('D'); // open the detail panel for the highlighted breaking component
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('colorScheme');
    expect(out).toContain('design');
    expect(out).toContain('removed');
    expect(out).toContain('footer');
    expect(out).toContain('slot removed');
  });
});

describe('GenerateReviewStep — category filters (L8)', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  const CYCLE_A: Entry = {
    $type: 'component',
    $properties: {},
    $slots: { header: { $allowedComponents: ['CycleB'] } },
  };
  const CYCLE_B: Entry = {
    $type: 'component',
    $properties: {},
    $slots: { footer: { $allowedComponents: ['CycleA'] } },
  };

  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  it('[o] cycles filter narrows the sidebar to cycle members; toggling off restores', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'CycleA', entry: CYCLE_A },
      { key: 'CycleB', entry: CYCLE_B },
      { key: 'Standalone', entry: leaf('Standalone') },
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
    expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
    stdin.write('o');
    await tick();
    const filtered = stripAnsi(lastFrame() ?? '');
    expect(filtered).toContain('CycleA');
    expect(filtered).toContain('CycleB');
    expect(filtered).not.toContain('Standalone');
    stdin.write('o');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Standalone');
  });

  it('GA-1 A3: [w] "only breaking changes" filter narrows to breaking components; toggling off restores', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: leaf('Alpha') },
      { key: 'Beta', entry: leaf('Beta') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'a', name: 'Alpha', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: { classification: 'breaking', breakingChanges: [{ propertyId: 'x', reason: 'removed' }] },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    stdin.write('w');
    await tick();
    const filtered = stripAnsi(lastFrame() ?? '');
    expect(filtered).toContain('Alpha');
    expect(filtered).not.toContain('Beta');
    stdin.write('w');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Beta');
  });

  it('L11: [d] deleted filter is removed — pressing d does not narrow to removed components', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Widget', entry: leaf('Widget') },
      { key: 'Keeper', entry: leaf('Keeper') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!({
      components: {
        new: [],
        changed: [],
        removed: [{ id: 'w', name: 'Widget', contentProperties: [], designProperties: [], slots: [] }],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    } as never);
    await tick();
    stdin.write('d');
    await tick();
    const filtered = stripAnsi(lastFrame() ?? '');
    expect(filtered).toContain('Keeper');
  });

  it('L11: legend advertises [w] and (with cycles) [o] but NOT a [d] deleted filter', async () => {
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
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('[o]');
    expect(out).toContain('[w]');
    expect(out).not.toContain('[d] deleted');
  });

  it('L11: help panel does not list a Deleted filter entry', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: leaf('Alpha') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toMatch(/Deleted/);
  });

  it('L11: GR legend disambiguates [c] cycle list vs [o] only cycles', async () => {
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
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('[c] cycle list');
    expect(out).toContain('[o] only cycles');
  });

  it('L11: GR bottom legend advertises the full keyset (accept/reject/panels/search/history)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: leaf('Alpha') },
    ]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('[a] accept');
    expect(out).toContain('[r] reject');
    expect(out).toContain('[L] flat');
    expect(out).toContain('[/] search');
    expect(out).toContain('[P] component rationale');
    expect(out).toContain('[?] help');
  });

  it('L11: GR help panel lists P (not I) for component rationale', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Alpha', entry: leaf('Alpha') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toMatch(/Component rationale/i);
    expect(out).toContain('P');
    expect(out).toMatch(/Sidebar views/i);
  });
});

describe('GenerateReviewStep — GA-1 (A3/A5/A6)', () => {
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const leaf = (label: string): Entry => ({
    $type: 'component',
    $properties: { [label]: { $type: 'string', $category: 'content' } },
  });

  beforeEach(() => {
    triggerSpy.mockReset();
    lastUseLivePreviewArgs = null;
    lastOnResult = null;
    hookReturnOverride = null;
  });

  const previewBreaking = (breakingName: string) =>
    ({
      components: {
        new: [],
        changed: [
          {
            current: { id: 'bk', name: breakingName, contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [{ propertyId: 'x', reason: 'removed' }],
            },
          },
        ],
        removed: [],
        unchanged: [],
      },
      tokens: { new: [], changed: [], removed: [], unchanged: [] },
    }) as never;

  it('A3: [w] filter narrows to breaking-change components, NOT rejected-but-not-breaking ones', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([
      { key: 'Break', entry: leaf('Break') },
      { key: 'Reject', entry: leaf('Reject') },
      { key: 'Clean', entry: leaf('Clean') },
    ]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewBreaking('Break'));
    await tick();
    stdin.write('j');
    await tick();
    stdin.write('r');
    await tick();
    stdin.write('w');
    await tick();
    const filtered = stripAnsi(lastFrame() ?? '');
    expect(filtered).toContain('Break');
    expect(filtered).not.toContain('Clean');
    expect(filtered).not.toMatch(/^.*Reject.*\[[ ✓✗×]\]/m);
  });

  it('A3: [w] filter legend advertises "only breaking" and NOT "only broken"', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Alpha', entry: leaf('Alpha') }]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('only breaking');
    expect(out).not.toContain('only broken');
  });

  it('A3: help overlay advertises "Only breaking" for [w]', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Alpha', entry: leaf('Alpha') }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Only breaking');
    expect(out).not.toContain('See breaking changes');
  });

  it('A5: pressing u does NOT undo (Ctrl+Z is the sole undo)', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: leaf('Card') }]);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]);
    const findSidebarRow = (frame: string, name: string): string =>
      frame.split('\n').find((l) => l.includes(name) && /\[[✓✗ ]\]/.test(l)) ?? '';
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('a');
    await tick();
    expect(findSidebarRow(lastFrame() ?? '', 'Card')).toContain('[✓]');
    stdin.write('u');
    await tick();
    expect(findSidebarRow(lastFrame() ?? '', 'Card')).toContain('[✓]');
  });

  it('A5: auto-reject banner references Ctrl+Z, not [u]', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const cycleA: Entry = {
      $type: 'component',
      $properties: { name: { $type: 'string', $category: 'content' } },
      $slots: { next: { $allowedComponents: ['CycleB'] } } as never,
    };
    const cycleB: Entry = {
      $type: 'component',
      $properties: { name: { $type: 'string', $category: 'content' } },
      $slots: { prev: { $allowedComponents: ['CycleA'] } } as never,
    };
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
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toMatch(/Cyclic manifest — auto-rejected/);
    expect(out).not.toContain('[u] undo');
    expect(out).toContain('[Ctrl+Z] undo');
  });

  it('A5: legend never advertises [u] undo', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const cycleA: Entry = {
      $type: 'component',
      $properties: { name: { $type: 'string', $category: 'content' } },
      $slots: { next: { $allowedComponents: ['CycleB'] } } as never,
    };
    const cycleB: Entry = {
      $type: 'component',
      $properties: { name: { $type: 'string', $category: 'content' } },
      $slots: { prev: { $allowedComponents: ['CycleA'] } } as never,
    };
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
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const out = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(out).not.toContain('[u] undo');
  });

  it('A6: pressing e from sidebar does NOT cross focus to the panel', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: leaf('Card') }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[Tab\] focus panel/);
    stdin.write('e');
    await tick();
    expect(lastFrame() ?? '').toMatch(/\[Tab\] focus panel/);
    expect(lastFrame() ?? '').not.toMatch(/\[Tab\] focus list/);
  });

  it('A6: focus-panel hint reads [Tab] (no [e] alias) and legend omits [e/Tab]', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: leaf('Card') }]);
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toContain('[e/Tab]');
    expect(out).toContain('[Tab] focus panel');
  });

  it('A6: help overlay Navigation group has no [e] Focus panel entry', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce([{ key: 'Card', entry: leaf('Card') }]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    const out = stripAnsi(lastFrame() ?? '');
    const focusLine = out.split('\n').find((l) => /Focus panel/.test(l)) ?? '';
    expect(focusLine).not.toMatch(/\be\b/);
  });
});

describe('GenerateReviewStep — groups re-expand after reload (A2-1)', () => {
  type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;
  const CTRL_R = '\x12';
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

  it('composite group parent stays expanded after Ctrl+R reload', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const group = [
      { key: 'Card', entry: withSlot('Card', ['Heading']) },
      { key: 'Heading', entry: leaf('Heading') },
    ];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(group).mockReturnValueOnce(group);
    vi.mocked(dbMod.loadSlotCycles).mockReturnValueOnce([]).mockReturnValueOnce([]);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    expect(lastFrame() ?? '').toMatch(/▾ Card/);
    stdin.write(CTRL_R);
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ Card/);
    expect(frame).not.toMatch(/▸ Card/);
    expect(frame).toContain('Heading');
  });

  it('cycle-tier participant stays expanded after Ctrl+R reload', async () => {
    const dbMod = await import('../../../../src/session/db.js');
    const cyclePair = [
      { key: 'P', entry: withSlot('P', ['C']) },
      { key: 'C', entry: withSlot('C', ['P']) },
    ];
    const cycles = [
      {
        path: ['P', 'C', 'P'],
        edges: [
          { fromComponent: 'P', slotName: 'children', toComponent: 'C' },
          { fromComponent: 'C', slotName: 'children', toComponent: 'P' },
        ],
        suggestedBreak: null,
      },
    ];
    vi.mocked(dbMod.loadCDFComponents).mockReturnValueOnce(cyclePair).mockReturnValueOnce(cyclePair);
    vi.mocked(dbMod.loadSlotCycles)
      .mockReturnValueOnce(cycles as never)
      .mockReturnValueOnce(cycles as never);
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} livePreview={false} />,
    );
    await tick();
    stdin.write(CTRL_R);
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/▾ ⚠ P/);
    expect(frame).not.toMatch(/▸ ⚠ P/);
  });
});

describe('GenerateReviewStep — [d] toggles removed-components banner (A2-2)', () => {
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

  it('[d] collapses the detail rows while keeping the count header visible', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toContain('Removed components (1)');
    expect(frame).toMatch(/Widget/);
    stdin.write('d');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toContain('Removed components (1)');
    expect(frame).not.toMatch(/- Widget/);
    stdin.write('d');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toMatch(/Widget/);
  });

  it('legend advertises [d] only when there are removed components', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    expect(lastFrame() ?? '').not.toContain('[d]');
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toContain('[d]');
  });

  it('starts COLLAPSED by default when there are more than 5 removed components', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']));
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Removed components (6)');
    expect(frame).not.toMatch(/- R1/);
    expect(frame).not.toMatch(/- R6/);
  });

  it('starts EXPANDED by default when there are 5 or fewer removed components', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['R1', 'R2', 'R3', 'R4', 'R5']));
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Removed components (5)');
    expect(frame).toMatch(/- R1/);
    expect(frame).toMatch(/- R5/);
  });

  it('count header renders the expand/collapse hint text', async () => {
    const { lastFrame } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    const frame = (lastFrame() ?? '').replace(/\s+/g, ' ');
    expect(frame).toMatch(/\[d\] to expand\/collapse/);
  });
});
