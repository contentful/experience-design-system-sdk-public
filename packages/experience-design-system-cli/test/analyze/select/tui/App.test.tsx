import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from '../../../../src/analyze/select/tui/App.js';

// Use vi.hoisted so devSession is available when vi.mock factories are hoisted
const { devSession } = await vi.hoisted(async () => {
  const { devSession } = await import('./fixtures/dev-session.js');
  return { devSession };
});

// Mock useSession to avoid file I/O
vi.mock('../../../../src/analyze/select/tui/hooks/useSession.js', () => ({
  useSession: () => ({
    session: devSession,
    paths: {
      sessionDir: '/tmp/test-session',
      statePath: '/tmp/test-session/state.json',
      eventsPath: '/tmp/test-session/events.jsonl',
    },
    loading: false,
    error: null,
    saveState: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock persistence to avoid file I/O
vi.mock('../../../../src/analyze/select/persistence.js', () => ({
  getRefineArtifactsRoot: () => '/tmp',
  getRefineSessionPaths: vi.fn().mockResolvedValue({
    sessionDir: '/tmp/test-session',
    statePath: '/tmp/test-session/state.json',
    eventsPath: '/tmp/test-session/events.jsonl',
  }),
  ensureRefineSession: vi.fn().mockResolvedValue(devSession),
}));

vi.mock('../../../../src/analyze/select/parser.js', () => ({
  loadReviewInput: vi.fn().mockResolvedValue(devSession),
}));

// Mock fs to avoid disk writes
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('// stub source'),
  access: vi.fn().mockResolvedValue(undefined),
}));

describe('App integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders component list after session loads', async () => {
    const { lastFrame } = render(<App sessionId="test-session-123" artifactsRoot="/tmp" reviewRoot="/tmp" />);
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Accordion');
  });

  it('shows status bar with component counts', async () => {
    const { lastFrame } = render(<App sessionId="test-session-123" artifactsRoot="/tmp" reviewRoot="/tmp" />);
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('accepted');
    expect(frame).toContain('rejected');
  });
});
