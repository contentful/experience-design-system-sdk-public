import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyAgents } from '../../src/tui/settings/agents/agent-store.js';
import { applyBinaryOverrides } from '../../src/tui/settings/agents/apply-binary-overrides.js';

// The pipeline reads an agent's binary only from EDS_AGENT_BINARY_<AGENT>. What matters here is who wins when the shell
// and Settings disagree, and that clearing a path in Settings puts the shell's value back instead of losing it.
describe('applying the saved binary paths', () => {
  const KEY = 'EDS_AGENT_BINARY_CLAUDE';
  const configWith = (binary: string) => {
    const agents = emptyAgents();
    agents.claude = { model: '', binary };
    return { defaultAgent: 'claude' as const, agents };
  };

  beforeEach(() => {
    delete process.env[KEY];
  });

  afterEach(() => {
    applyBinaryOverrides({ defaultAgent: 'claude', agents: emptyAgents() });
    delete process.env[KEY];
  });

  it('points the pipeline at the saved path', () => {
    applyBinaryOverrides(configWith('/opt/bin/claude'));

    expect(process.env[KEY]).toBe('/opt/bin/claude');
  });

  it('wins over a variable already set in the shell', () => {
    process.env[KEY] = '/from/the/shell';

    applyBinaryOverrides(configWith('/opt/bin/claude'));

    expect(process.env[KEY]).toBe('/opt/bin/claude');
  });

  it('leaves the shell’s variable alone when nothing is saved', () => {
    process.env[KEY] = '/from/the/shell';

    applyBinaryOverrides(configWith(''));

    expect(process.env[KEY]).toBe('/from/the/shell');
  });

  it('gives the shell’s value back when the saved path is cleared', () => {
    process.env[KEY] = '/from/the/shell';
    applyBinaryOverrides(configWith('/opt/bin/claude'));

    applyBinaryOverrides(configWith(''));

    expect(process.env[KEY]).toBe('/from/the/shell');
  });

  it('leaves the variable unset again when it was unset before', () => {
    applyBinaryOverrides(configWith('/opt/bin/claude'));

    applyBinaryOverrides(configWith(''));

    expect(process.env[KEY]).toBeUndefined();
  });
});
