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
    expect(content).toMatch(/use its name as context/i);
    expect(content).toMatch(/Document your reasoning in `description`/i);
    expect(content).toMatch(/WARNING: type unknown/);
  });

  it('documents the token-name sidecar', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toMatch(/token.name sidecar|sidecar/i);
    expect(content).toMatch(/sidecar|mapping|name.*map/i);
  });

  it('requires pre-emit validation and preserves unresolved warnings', async () => {
    const content = await readSkill('generate-tokens.md');
    expect(content).toContain('Before emitting any tool calls, verify:');
    expect(content).toContain('Every raw token in the input has exactly one `set_token` call');
    expect(content).toContain('No duplicate paths.');
    expect(content).toMatch(/iterate on any warning the supplied input can resolve/i);
    expect(content).toContain('Preserve unresolved warnings in the token `description`');
    expect(content).toContain('do not guess values');
    expect(content).not.toMatch(/(?:experience-design-system-cli|experiences)\s+print\s+validate\b/);
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
    expect(content).toContain('https://contentful.com/schemas/cdf');
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

  it('requires pre-emit validation and preserves unresolved warnings', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toContain('Before emitting any tool calls, verify:');
    expect(content).toContain('Every prop in the input has exactly one `classify_prop` or `exclude_prop` call');
    expect(content).toContain('Every slot has exactly one `classify_slot` call');
    expect(content).toMatch(/iterate on any warning the supplied evidence can resolve/i);
    expect(content).toContain('Preserve unresolved warnings in the relevant `description` or `reason`');
    expect(content).toContain('do not invent values');
    expect(content).not.toMatch(/(?:experience-design-system-cli|experiences)\s+print\s+validate\b/);
  });

  it('stops emitting values for token-typed props', async () => {
    const content = await readSkill('generate-components.md');
    expect(content).toMatch(/do not include.*values.*cdf_type.*token/i);
    expect(content).toMatch(/\$token\.allowed/);
  });
});

describe('map-tokens.md', () => {
  it('exists', async () => {
    await expect(readSkill('map-tokens.md')).resolves.toBeDefined();
  });

  it('includes all required sections', async () => {
    const content = await readSkill('map-tokens.md');
    for (const section of ['Purpose', 'Input', 'Decision tree', 'Output protocol', 'Examples', 'Checklist']) {
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
