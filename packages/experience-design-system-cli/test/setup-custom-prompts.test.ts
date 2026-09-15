import { describe, it, expect } from 'vitest';
import { promptCodexModel, promptCustomSkillPath } from '../src/setup/command.js';

describe('promptCodexModel', () => {
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
