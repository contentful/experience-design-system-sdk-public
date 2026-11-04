import { beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  db: { close: vi.fn() },
  open: vi.fn(),
  version: vi.fn<() => Promise<string>>(),
  hash: vi.fn<() => Promise<string>>(),
}));
vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@contentful/experience-design-system-backend-pipeline')>()),
  openPipelineDb: deps.open,
  getCliCacheVersion: deps.version,
  hashFile: deps.hash,
}));
vi.mock('../../../src/tui/import/steps/06-extraction/find-skill-path.js', () => ({ findSkillPath: () => '/skill.md' }));
vi.mock('../../../src/tui/debug-store.js', () => ({ recordDebugEvent: vi.fn() }));
import { runSelection } from '../../../src/tui/import/steps/06-extraction/selection.js';

beforeEach(() => {
  vi.clearAllMocks();
  deps.open.mockReturnValue(deps.db);
  deps.version.mockResolvedValue('version');
  deps.hash.mockResolvedValue('hash');
});

describe('selection preparation cancellation', () => {
  it.each(['version', 'hash'] as const)(
    'closes the read database when aborted during %s preparation',
    async (preparation) => {
      const controller = new AbortController();
      let finish!: (value: string) => void;
      deps[preparation].mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const running = runSelection({ sessionId: 'session', agent: 'claude', noCache: true, signal: controller.signal });
      await vi.waitFor(() => expect(deps[preparation]).toHaveBeenCalledOnce());
      controller.abort();
      finish('prepared');

      await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      expect(deps.open).toHaveBeenCalledOnce();
      expect(deps.db.close).toHaveBeenCalledOnce();
    },
  );
});
