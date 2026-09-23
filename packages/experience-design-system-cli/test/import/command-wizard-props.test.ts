import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const renderMock = vi.fn(() => ({ waitUntilExit: vi.fn().mockResolvedValue(undefined) }));
const createElementMock = vi.fn((_component: unknown, props: unknown) => props);

vi.mock('ink', () => ({ render: renderMock }));
vi.mock('react', () => ({ createElement: createElementMock }));
vi.mock('../../src/import/tui/WizardApp.js', () => ({ WizardApp: vi.fn() }));

const readExperiencesCredentialsMock = vi.fn();
vi.mock('../../src/credentials-store.js', () => ({
  readExperiencesCredentials: readExperiencesCredentialsMock,
}));

vi.mock('../../src/lib/terminal-capabilities.js', () => ({
  getInteractiveTerminalSupport: () => ({ supported: true }),
  requireInteractiveTerminal: vi.fn(),
}));

const { registerImportCommand } = await import('../../src/import/command.js');

async function runImport(): Promise<Record<string, unknown>> {
  const program = new Command();
  registerImportCommand(program);
  await program.parseAsync(['node', 'experiences', 'import']);
  const props = createElementMock.mock.calls.at(-1)?.[1];
  return props as Record<string, unknown>;
}

describe('import command wizard prop forwarding', () => {
  beforeEach(() => {
    renderMock.mockClear();
    createElementMock.mockClear();
    readExperiencesCredentialsMock.mockReset();
    readExperiencesCredentialsMock.mockResolvedValue({
      spaceId: 'space-1',
      environmentId: 'master',
      cmaToken: 'token',
      selectPromptPath: '/tmp/select.md',
      generatePromptPath: '/tmp/generate.md',
    });
  });

  it('forwards selectPromptPath from credentials to WizardApp', async () => {
    const props = await runImport();
    expect(props.selectPromptPath).toBe('/tmp/select.md');
  });

  it('forwards generatePromptPath from credentials to WizardApp', async () => {
    const props = await runImport();
    expect(props.generatePromptPath).toBe('/tmp/generate.md');
  });

  it('omits generatePromptPath when not configured in credentials', async () => {
    readExperiencesCredentialsMock.mockResolvedValue({
      spaceId: 'space-1',
      environmentId: 'master',
      cmaToken: 'token',
    });
    const props = await runImport();
    expect(props.generatePromptPath).toBeUndefined();
  });
});
