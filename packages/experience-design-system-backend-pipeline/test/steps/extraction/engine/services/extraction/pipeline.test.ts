import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { extractComponents } from '../../../../../../src/steps/extraction/src/services/extraction/extract-components.js';
import { extractReactComponents } from '../../../../../../src/steps/extraction/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeFixture(filePath: string, source: string): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, source);
  return filePath;
}

const VUE_BUTTON = `
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><button>{{ label }}</button></template>
`;

describe('extractComponents pipeline contract', () => {
  it.each(['Surface', 'useSurface'])('preserves rendered Vue candidates independently of the name %s', async (name) => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-pipeline-name-'));
    tempDirs.push(projectRoot);
    const source = await writeFixture(join(projectRoot, `${name}.vue`), VUE_BUTTON);
    const result = await extractComponents([source], undefined, { projectRoot });
    expect(result.components.map((component) => component.name)).toEqual([name]);
    expect(result.components[0]?.props.map((prop) => prop.name)).toContain('label');
    expect(result.exclusions?.some((entry) => entry.name === name)).not.toBe(true);
    expect(result.warnings.some((warning) => warning.includes('Skipped hook'))).toBe(false);
  });

  it('preserves a rendered React alias without inferring behavior from its declaration name', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-pipeline-rendered-name-'));
    tempDirs.push(projectRoot);
    const source = await writeFixture(
      join(projectRoot, 'useSurface.tsx'),
      'function useSurface(props: { label: string }) { return <section>{props.label}</section>; } export { useSurface as Surface };',
    );
    const adapter = await extractReactComponents([source], undefined, { projectRoot });
    expect(adapter.components.map((component) => component.name)).toContain('Surface');
    const result = await extractComponents([source], undefined, { projectRoot });
    expect(result.components.map((component) => component.name)).toContain('Surface');
    expect(result.components[0]?.sourceCandidates?.map((candidate) => candidate.name)).toContain('label');
  });

  it('routes supported files, ignores unmatched files, and reports aggregate progress', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-pipeline-progress-'));
    tempDirs.push(projectRoot);
    const first = await writeFixture(join(projectRoot, 'Alpha.vue'), VUE_BUTTON);
    const second = await writeFixture(join(projectRoot, 'Beta.vue'), VUE_BUTTON);
    const ignored = await writeFixture(join(projectRoot, 'notes.md'), 'not a component');
    const progress: Array<{ filesProcessed: number; componentsFound: number }> = [];

    const result = await extractComponents([first, second, ignored], (update) => progress.push(update));

    expect(result.components.map((component) => component.name)).toEqual(['Alpha', 'Beta']);
    expect(progress.at(-1)).toEqual({ filesProcessed: 2, componentsFound: 2 });
    expect(progress.every((update) => update.filesProcessed >= 0 && update.componentsFound >= 0)).toBe(true);
  });

  it('deduplicates components in one family and prefers the index entrypoint', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-pipeline-dedupe-'));
    tempDirs.push(projectRoot);
    const implementation = await writeFixture(join(projectRoot, 'src/components/Button/Button.vue'), VUE_BUTTON);
    const index = await writeFixture(join(projectRoot, 'src/components/Button/index.vue'), VUE_BUTTON);

    const result = await extractComponents([implementation, index]);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.source).toBe(index);
    expect(result.warnings).toContainEqual(expect.stringContaining('Duplicate component "Button"'));
  });

  it('returns no components or warnings when no extractor accepts the input files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-pipeline-empty-'));
    tempDirs.push(projectRoot);
    const sourcePath = await writeFixture(join(projectRoot, 'notes.md'), 'not a component');

    await expect(extractComponents([sourcePath])).resolves.toEqual({
      components: [],
      warnings: [],
      compilerSources: [],
      sourceInventory: undefined,
    });
  });
});
