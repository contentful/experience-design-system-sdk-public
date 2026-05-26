import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESIGN_TOKEN_TYPES, CDF_PROPERTY_TYPES } from '@contentful/experience-design-system-types';

const skillsDir = resolve(import.meta.dirname, '../skills');

async function readSkill(filename: string): Promise<string> {
  return readFile(resolve(skillsDir, filename), 'utf-8');
}

const REQUIRED_SECTIONS = [
  'Purpose',
  'Prerequisites',
  'Target schema',
  'Mapping guidance',
  'Examples',
  'Edge cases',
  'Validation step',
];

describe('generate-tokens.md', () => {
  it('exists', async () => {
    await expect(readSkill('generate-tokens.md')).resolves.toBeDefined();
  });

  it('includes all required sections', async () => {
    const content = await readSkill('generate-tokens.md');
    for (const section of REQUIRED_SECTIONS) {
      expect(content, `missing section: ${section}`).toMatch(new RegExp(`#.*${section}`, 'i'));
    }
  });

  it('explains DTCG leaf token requirements', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toContain('$type');
    expect(content).toContain('$value');
    expect(content).toMatch(/explicit.*\$type.*leaf|every leaf.*\$type/i);
  });

  it('lists all 13 valid token types', async () => {
    const content = await readSkill('generate-tokens.md');
    for (const tokenType of DESIGN_TOKEN_TYPES) {
      expect(content, `missing token type: ${tokenType}`).toContain(tokenType);
    }
  });

  it('explains ambiguity resolution', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toMatch(/ambiguous/i);
    expect(content).toMatch(/inferredKind/);
    expect(content).toMatch(/developer/i);
  });

  it('documents the token-name sidecar', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toMatch(/token.name sidecar|sidecar/i);
    expect(content).toMatch(/sidecar|mapping|name.*map/i);
  });

  it('instructs agent to run CLI validation loop', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toContain('validate --tokens');
    expect(content).toMatch(/iterate|loop|re-run|repeat/i);
  });
});

describe('generate-components.md', () => {
  it('exists', async () => {
    await expect(readSkill('generate-components.md')).resolves.toBeDefined();
  });

  it('includes all required sections', async () => {
    const content = await readSkill('generate-components.md');
    for (const section of REQUIRED_SECTIONS) {
      expect(content, `missing section: ${section}`).toMatch(new RegExp(`#.*${section}`, 'i'));
    }
  });

  it('explains CDF root structure', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('https://contentful.com/schemas/cdf/v1');
    expect(content).toMatch(/\$type.*component/);
  });

  it('explains prop classification rules', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('content');
    expect(content).toContain('design');
    expect(content).toContain('state');
    expect(content).toMatch(/\$category/);
  });

  it('lists all valid CDF property types', async () => {
    const content = await readSkill('generate-components.md');
    for (const propType of CDF_PROPERTY_TYPES) {
      expect(content, `missing CDF property type: ${propType}`).toContain(propType);
    }
  });

  it('explains token-aware property handling', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('$token.kind');
    expect(content).toMatch(/token.name sidecar|sidecar/i);
    expect(content).toMatch(/DTCG.*\$type|look.*up.*token/i);
  });

  it('explains slot handling', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('$slots');
    expect(content).toContain('$allowedComponents');
  });

  it('explains prop exclusion of framework internals', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toMatch(/className|style|ref|event handler/i);
    expect(content).toMatch(/exclud|omit|filter|skip/i);
  });

  it('instructs agent to run CLI validation loop', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('validate --components');
    expect(content).toMatch(/iterate|loop|re-run|repeat/i);
  });
});

describe('packaging', () => {
  it('package.json includes skills in files', async () => {
    const pkg = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf-8'));
    expect(pkg.files).toContain('skills/');
  });
});
