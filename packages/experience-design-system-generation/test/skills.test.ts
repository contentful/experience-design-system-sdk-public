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

  it('stops emitting values for token-typed props', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toMatch(/do not include.*values.*cdf_type.*token/i);
    expect(content).toMatch(/\$token\.allowed/);
  });

  it('states the cardinality rule for the two token-evidence signals', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toMatch(/cardinality/i);
    expect(content).toMatch(/one token target/i);
  });
});

describe('map-tokens.md', () => {
  it('exists', async () => {
    await expect(readSkill('map-tokens.md')).resolves.toBeDefined();
  });

  it('includes all required sections', async () => {
    const content = await readSkill('map-tokens.md');
    for (const section of REQUIRED_SECTIONS) {
      expect(content, `missing section: ${section}`).toMatch(new RegExp(`#.*${section}`, 'i'));
    }
  });

  it('describes the $token.allowed target field', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toContain('$token.allowed');
    expect(content).not.toContain('$token.sets');
  });

  it('documents the map_token_prop tool call, token_allowed only', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toContain('map_token_prop');
    expect(content).toContain('token_allowed');
    expect(content).not.toMatch(/\btoken_sets\b/);
  });

  it('scopes candidates to the prop\'s $token.kind', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toMatch(/\$token\.kind/);
  });

  it('only narrows props that arrive without an existing token list', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toMatch(/without an existing|no existing token (list|allowed)|already (has|arrived)/i);
  });

  it('forbids hallucinated paths not in the token path index', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toMatch(/never invent a path|no hallucinated paths/i);
  });

  it('instructs emitting nothing without restriction evidence', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toMatch(/emit nothing/i);
    expect(content).toMatch(/evidence/i);
  });

  it('treats an existing tokenReference as high-confidence evidence', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).toMatch(/tokenReference/);
    expect(content).toMatch(/high-confidence/i);
    expect(content).toMatch(/never contradict/i);
  });

  it('contains no CLI-specific or local filesystem instructions', async () => {
    const content = await readSkill('map-tokens.md');
    expect(content).not.toMatch(/run this command|read the file at|open the file/i);
  });
});

describe('packaging', () => {
  it('package.json includes skills in files', async () => {
    const pkg = JSON.parse(await readFile(resolve(import.meta.dirname, '../package.json'), 'utf-8'));
    expect(pkg.files).toContain('skills/');
  });
});
