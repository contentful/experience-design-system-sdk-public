import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const client = JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8'));

describe('client build configuration', () => {
  it('invalidates code generation for generator and configuration changes', () => {
    expect(client.targets.codegen.cache).toBe(true);
    for (const input of [
      '{projectRoot}/openapi.json',
      '{projectRoot}/bin/**/*',
      '{projectRoot}/tsconfig.json',
      '{projectRoot}/package.json',
      '{workspaceRoot}/pnpm-lock.yaml',
    ]) {
      expect(client.targets.codegen.inputs).toContain(input);
    }
  });
});
