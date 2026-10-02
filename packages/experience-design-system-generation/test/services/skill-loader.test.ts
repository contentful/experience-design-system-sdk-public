import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillContent, resolveSkillPath } from '../../src/generate/services/skill-loader.js';

describe('skill loader service', () => {
  it('resolves every packaged skill from the source tree', () => {
    expect(resolveSkillPath('components')).toMatch(/skills\/generate-components\.md$/);
    expect(resolveSkillPath('tokens')).toMatch(/skills\/generate-tokens\.md$/);
    expect(resolveSkillPath('select')).toMatch(/skills\/select-components\.md$/);
    expect(resolveSkillPath('map-tokens')).toMatch(/skills\/map-tokens\.md$/);
  });

  it('loads a custom skill path instead of the bundled asset', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eds-skill-loader-'));
    try {
      const customPath = join(dir, 'custom.md');
      await writeFile(customPath, 'CUSTOM_SKILL', 'utf8');
      await expect(loadSkillContent('components', customPath)).resolves.toBe('CUSTOM_SKILL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
