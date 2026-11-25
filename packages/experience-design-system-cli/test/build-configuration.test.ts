import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cli = JSON.parse(readFileSync(new URL('../project.json', import.meta.url), 'utf8'));
const nx = JSON.parse(readFileSync(new URL('../../../nx.json', import.meta.url), 'utf8'));
const readProject = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../experience-design-system-${name}/project.json`, import.meta.url), 'utf8'));

describe('workspace CLI build', () => {
  it('builds both entry points and declarations in one compiler task', () => {
    expect(cli.targets.build.executor).toBe('nx:noop');
    expect(cli.targets.build.dependsOn).toEqual(['compile', 'copy-assets']);
    expect(cli.targets.build.cache).toBe(false);
    expect(cli.targets.compile.cache).toBe(false);
    expect(cli.targets.compile.dependsOn).toEqual(['^build']);
    expect(cli.targets.compile.options.additionalEntryPoints).toEqual([
      'packages/experience-design-system-cli/app.tsx',
    ]);
    expect(cli.targets.compile.options.outputFileName).toBeUndefined();
    expect(cli.targets.compile.options.declaration).toBe(true);
    expect(cli.targets['compile-app'].dependsOn).toEqual(['compile']);
  });

  it('caches copied assets separately with their source inputs and outputs', () => {
    const assets = cli.targets['copy-assets'];
    expect(assets.cache).toBe(true);
    expect(assets.outputs).toEqual([
      '{workspaceRoot}/packages/experience-design-system-cli/skills',
      '{workspaceRoot}/packages/experience-design-system-cli/prompts',
    ]);
    for (const source of ['generation/*.md', 'selection/*.md']) {
      expect(assets.inputs).toContain(
        `{workspaceRoot}/packages/experience-design-system-backend-pipeline/src/agents/skills/${source}`,
      );
    }
    expect(assets.inputs).toContain('{workspaceRoot}/packages/experience-design-system-backend-pipeline/prompts/**/*');
  });

  it('preserves live output while compiling', () => {
    expect(nx.targetDefaults.build.dependsOn).toEqual(['^build']);
    expect(cli.targets.compile.options.deleteOutputPath).toBe(false);
  });

  it('preserves live output for TypeScript packages without restoring it from cache', () => {
    for (const name of ['types', 'client', 'backend-pipeline']) {
      const build = readProject(name).targets.build;
      expect(build.executor).toBe('@nx/js:tsc');
      expect(build.cache).toBe(false);
      expect(build.options.clean).toBe(false);
      expect(build.dependsOn).toContain('^build');
    }
  });
});
