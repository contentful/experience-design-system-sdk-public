import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyAgents, readAgentConfig, writeAgentConfig } from '../../src/tui/settings/agents/agent-store.js';

// The agent settings share config.json with the credentials, so the point of these tests is what a save does to the
// rest of the file, and that the two keys the import reads (agent, agentModel) always agree with the new section.
describe('the agent settings in config.json', () => {
  let home: string;
  let previousHome: string | undefined;
  const file = () => join(home, 'config.json');
  const onDisk = async () => JSON.parse(await readFile(file(), 'utf8')) as Record<string, unknown>;
  const seed = (settings: Record<string, unknown>) => writeFile(file(), JSON.stringify(settings));

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'agent-store-'));
    previousHome = process.env.EDS_HOME;
    process.env.EDS_HOME = home;
  });

  afterEach(async () => {
    if (previousHome === undefined) delete process.env.EDS_HOME;
    else process.env.EDS_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  describe('reading', () => {
    it('is Claude with no models when nothing has been saved', async () => {
      expect(await readAgentConfig()).toEqual({ defaultAgent: 'claude', agents: emptyAgents() });
    });

    it('reads the default agent and each agent’s own model', async () => {
      await seed({ agent: 'codex', agents: { codex: { model: 'gpt-5' }, claude: { model: 'sonnet' } } });

      const config = await readAgentConfig();

      expect(config.defaultAgent).toBe('codex');
      expect(config.agents.codex.model).toBe('gpt-5');
      expect(config.agents.claude.model).toBe('sonnet');
      expect(config.agents.opencode.model).toBe('');
    });

    it('falls back to Claude for an agent name it does not know', async () => {
      await seed({ agent: 'not-an-agent' });

      expect((await readAgentConfig()).defaultAgent).toBe('claude');
    });

    it('survives a settings file with the wrong shapes in it', async () => {
      await seed({ agent: 42, agentModel: ['x'], agents: 'nope' });

      expect(await readAgentConfig()).toEqual({ defaultAgent: 'claude', agents: emptyAgents() });
    });

    it('ignores an agent entry it does not know and one with a model that is not text', async () => {
      await seed({ agents: { claude: { model: 7 }, imaginary: { model: 'x' } } });

      const config = await readAgentConfig();

      expect(config.agents.claude.model).toBe('');
      expect(Object.keys(config.agents).sort()).toEqual(['claude', 'codex', 'copilot', 'cursor', 'opencode']);
    });

    it('shows a model saved by `experiences setup` against the agent that was the default', async () => {
      await seed({ agent: 'codex', agentModel: 'gpt-5' });

      expect((await readAgentConfig()).agents.codex.model).toBe('gpt-5');
    });

    it('prefers the per-agent model to the older global one when both exist', async () => {
      await seed({ agent: 'codex', agentModel: 'old', agents: { codex: { model: 'new' } } });

      expect((await readAgentConfig()).agents.codex.model).toBe('new');
    });
  });

  describe('writing', () => {
    const config = (defaultAgent: 'claude' | 'codex', models: Partial<Record<string, string>> = {}) => {
      const agents = emptyAgents();
      for (const [name, model] of Object.entries(models))
        agents[name as keyof typeof agents] = { model: model ?? '', binary: '' };
      return { defaultAgent, agents };
    };

    it('keeps the credentials and every other setting', async () => {
      await seed({ spaceId: 's', cmaToken: 'secret', analyticsDisabled: true, debugMode: { enabled: true }, extra: 1 });

      await writeAgentConfig(config('codex', { codex: 'gpt-5' }));

      expect(await onDisk()).toMatchObject({
        spaceId: 's',
        cmaToken: 'secret',
        analyticsDisabled: true,
        debugMode: { enabled: true },
        extra: 1,
      });
    });

    it('writes the default agent to `agent` and its model to `agentModel`, which is what the import reads', async () => {
      await writeAgentConfig(config('codex', { codex: 'gpt-5', claude: 'sonnet' }));

      expect(await onDisk()).toMatchObject({ agent: 'codex', agentModel: 'gpt-5' });
    });

    it('keeps another agent’s model when the default changes, and moves `agentModel` with the default', async () => {
      await writeAgentConfig(config('claude', { claude: 'sonnet', codex: 'gpt-5' }));
      await writeAgentConfig({ ...(await readAgentConfig()), defaultAgent: 'codex' });

      expect(await onDisk()).toMatchObject({
        agent: 'codex',
        agentModel: 'gpt-5',
        agents: { claude: { model: 'sonnet' }, codex: { model: 'gpt-5' } },
      });
    });

    it('removes `agentModel` when the default agent has no model, so a stale one is not used', async () => {
      await seed({ agent: 'claude', agentModel: 'sonnet' });

      await writeAgentConfig(config('codex', { claude: 'sonnet' }));

      const saved = await onDisk();
      expect(saved['agent']).toBe('codex');
      expect(saved).not.toHaveProperty('agentModel');
    });

    it('leaves out agents with no model, and the whole section when none have one', async () => {
      await seed({ agents: { claude: { model: 'sonnet' } }, agentModel: 'sonnet' });

      await writeAgentConfig(config('claude', {}));

      const saved = await onDisk();
      expect(saved).not.toHaveProperty('agents');
      expect(saved).not.toHaveProperty('agentModel');
    });

    it('trims the model, and treats a blank one as none', async () => {
      await writeAgentConfig(config('claude', { claude: '  sonnet  ', codex: '   ' }));

      expect((await onDisk())['agents']).toEqual({ claude: { model: 'sonnet' } });
    });

    it('saves a binary path without a model, and keeps it when the model changes', async () => {
      const withPath = config('claude', {});
      withPath.agents.claude = { model: '', binary: '  /opt/bin/claude  ' };
      await writeAgentConfig(withPath);

      expect((await onDisk())['agents']).toEqual({ claude: { binary: '/opt/bin/claude' } });

      const read = await readAgentConfig();
      read.agents.claude = { ...read.agents.claude, model: 'sonnet' };
      await writeAgentConfig(read);

      expect((await onDisk())['agents']).toEqual({ claude: { model: 'sonnet', binary: '/opt/bin/claude' } });
    });

    it('can be read back as it was written', async () => {
      const written = config('codex', { claude: 'sonnet', codex: 'gpt-5', opencode: 'anthropic/claude-sonnet' });

      await writeAgentConfig(written);

      expect(await readAgentConfig()).toEqual(written);
    });
  });
});
