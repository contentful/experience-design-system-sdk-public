import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promptCodexModel, promptCustomSkillPath } from '../src/setup/command.js';

describe('promptCodexModel', () => {
  // promptCodexModel short-circuits when OPENAI_API_KEY is set, so the prompting
  // tests below must run with it absent regardless of the ambient environment.
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns undefined without prompting when OPENAI_API_KEY is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    let asked = false;
    const ask = async () => {
      asked = true;
      return 'gpt-5.6-luna';
    };
    const result = await promptCodexModel(ask);
    expect(result).toBeUndefined();
    expect(asked).toBe(false);
  });

  it('returns a trimmed model name when the operator supplies one', async () => {
    const ask = async () => '  gpt-5.6-luna  ';
    const result = await promptCodexModel(ask);
    expect(result).toBe('gpt-5.6-luna');
  });

  it('returns undefined when the operator presses Enter', async () => {
    const ask = async () => '';
    const result = await promptCodexModel(ask);
    expect(result).toBeUndefined();
  });
});

describe('promptCustomSkillPath (Feature 8)', () => {
  it('returns the trimmed path when the operator supplies one', async () => {
    const ask = async () => '  /tmp/custom-select.md  ';
    const result = await promptCustomSkillPath('select', undefined, ask);
    expect(result).toBe('/tmp/custom-select.md');
  });

  it('returns undefined (keep current) when the operator presses Enter', async () => {
    const ask = async () => '';
    const result = await promptCustomSkillPath('generate', '/old/path.md', ask);
    expect(result).toBeUndefined();
  });

  it('returns null (clear) when the operator types "-"', async () => {
    const ask = async () => '-';
    const result = await promptCustomSkillPath('select', '/old/path.md', ask);
    expect(result).toBeNull();
  });

  it('shows the current value in the prompt question text', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptCustomSkillPath('generate', '/existing/path.md', ask);
    expect(asked).toContain('/existing/path.md');
    expect(asked).toContain('generate');
  });

  it('shows "[none]" when no current value is set', async () => {
    let asked = '';
    const ask = async (q: string) => {
      asked = q;
      return '';
    };
    await promptCustomSkillPath('select', undefined, ask);
    expect(asked).toContain('[none]');
  });
});
