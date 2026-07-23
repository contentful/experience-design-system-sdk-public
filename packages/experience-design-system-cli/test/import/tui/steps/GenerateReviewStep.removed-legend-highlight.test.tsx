import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SAMPLE_ENTRY = {
  $type: 'component' as const,
  $properties: { variant: { $type: 'enum' as const, $category: 'content' as const, $values: ['a', 'b'] } },
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
    description: 'd',
    descriptionRationale: '',
    propsRationale: '',
    slotsRationale: '',
    props: [],
    slots: [],
  }),
}));

vi.mock('../../../../src/import/tui/components/LegendEntry.js', () => ({
  legendEntry: (keyBracket: string, label: string, active = false) => (
    <Text key={keyBracket + label}>{`«${keyBracket}|${label}|${active ? 'ACTIVE' : 'inactive'}»`}</Text>
  ),
}));

let lastOnResult:
  | ((r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void)
  | null = null;
vi.mock('../../../../src/import/tui/useLivePreview.js', () => ({
  useLivePreview: (args: {
    onResult: (r: import('@contentful/experience-design-system-types').ServerPreviewResponse | null) => void;
  }) => {
    lastOnResult = args.onResult;
    return { trigger: vi.fn(), status: 'idle' as const, disabled: false };
  },
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

describe('GenerateReviewStep — [d] legend highlight tracks banner-open (A2-2)', () => {
  it('[d] legend entry is highlighted when expanded, un-highlighted when collapsed', async () => {
    const { lastFrame, stdin } = render(
      <GenerateReviewStep extractSessionId="sess-1" onFinalize={vi.fn()} onQuit={vi.fn()} />,
    );
    await tick();
    lastOnResult!(previewWithRemoved(['Widget']));
    await tick();
    let frame = lastFrame() ?? '';
    expect(frame).toContain('«[d]|hide removed|ACTIVE»');
    expect(frame).not.toContain('«[d]|hide removed|inactive»');

    stdin.write('d');
    await tick();
    frame = lastFrame() ?? '';
    expect(frame).toContain('«[d]|show removed|inactive»');
    expect(frame).not.toContain('«[d]|show removed|ACTIVE»');
  });
});
