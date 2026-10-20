import { afterEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ read: vi.fn(), disabled: vi.fn() }));
vi.mock('../src/tui/settings/opt-in-analytics/analytics-store.js', () => ({ readAnalyticsSetting: deps.read }));
vi.mock('../src/commands/import.js', () => ({ registerImportCommand: vi.fn() }));
vi.mock('@contentful/experience-design-system-backend-pipeline', () => ({
  completeActiveCommand: vi.fn(),
  failActiveCommand: vi.fn(),
  flushAnalytics: vi.fn(),
  noteCommandStart: vi.fn(),
  setCliVersion: vi.fn(),
  setPersistedAnalyticsDisabled: deps.disabled,
}));
import { createProgram } from '../program.js';
afterEach(() => {
  vi.restoreAllMocks();
});
it('startup reports a settings failure, disables analytics and keeps command access', async () => {
  deps.read.mockRejectedValue(new Error('Settings unavailable'));
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const listeners = new Set(process.listeners('unhandledRejection'));
  const program = createProgram();
  const action = vi.fn();
  program.command('probe').action(action);
  try {
    await expect(program.parseAsync(['node', 'experiences', 'probe'])).resolves.toBeDefined();
    expect(action).toHaveBeenCalledOnce();
    expect(deps.disabled).toHaveBeenCalledWith(true);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Settings unavailable'));
  } finally {
    for (const listener of process.listeners('unhandledRejection'))
      if (!listeners.has(listener)) process.removeListener('unhandledRejection', listener);
  }
});
