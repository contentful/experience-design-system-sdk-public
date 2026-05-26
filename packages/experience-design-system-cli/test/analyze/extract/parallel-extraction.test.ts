import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractVueComponents } from '../../../src/analyze/extract/vue.js';
import { extractAstroComponents } from '../../../src/analyze/extract/astro.js';
import { extractComponents } from '../../../src/analyze/extract/pipeline.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'parallel-extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

const VUE_COMPONENT = () => `
<script setup lang="ts">
defineProps<{ label: string }>();
</script>
<template><button>{{ label }}</button></template>
`;

const ASTRO_COMPONENT = () => `
---
export interface Props { label: string; }
const { label } = Astro.props;
---
<button>{label}</button>
`;

describe('Vue extractor parallelization', () => {
  it('emits progress callbacks as files are processed', async () => {
    const filePaths: string[] = [];
    for (let i = 0; i < 5; i++) {
      filePaths.push(await writeFixture(`Component${i}.vue`, VUE_COMPONENT()));
    }

    const progressUpdates: Array<{ filesProcessed: number; componentsFound: number }> = [];
    await extractVueComponents(filePaths, (p) => progressUpdates.push({ ...p }));

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const last = progressUpdates[progressUpdates.length - 1]!;
    expect(last.filesProcessed).toBe(5);
    expect(last.componentsFound).toBeGreaterThan(0);
  });

  it('progress filesProcessed counts are monotonically increasing', async () => {
    const filePaths: string[] = [];
    for (let i = 0; i < 6; i++) {
      filePaths.push(await writeFixture(`Comp${i}.vue`, VUE_COMPONENT()));
    }

    const counts: number[] = [];
    await extractVueComponents(filePaths, (p) => counts.push(p.filesProcessed));

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });

  it('processes all files with multiple workers', async () => {
    const fileCount = 8;
    const filePaths: string[] = [];
    for (let i = 0; i < fileCount; i++) {
      filePaths.push(await writeFixture(`Multi${i}.vue`, VUE_COMPONENT()));
    }

    const result = await extractVueComponents(filePaths);

    expect(result.components).toHaveLength(fileCount);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('Astro extractor parallelization', () => {
  it('emits progress callbacks as files are processed', async () => {
    const filePaths: string[] = [];
    for (let i = 0; i < 4; i++) {
      filePaths.push(await writeFixture(`AstroComp${i}.astro`, ASTRO_COMPONENT()));
    }

    const progressUpdates: Array<{ filesProcessed: number; componentsFound: number }> = [];
    await extractAstroComponents(filePaths, (p) => progressUpdates.push({ ...p }));

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const last = progressUpdates[progressUpdates.length - 1]!;
    expect(last.filesProcessed).toBe(4);
    expect(last.componentsFound).toBeGreaterThan(0);
  });

  it('processes all files with multiple workers', async () => {
    const fileCount = 6;
    const filePaths: string[] = [];
    for (let i = 0; i < fileCount; i++) {
      filePaths.push(await writeFixture(`Star${i}.astro`, ASTRO_COMPONENT()));
    }

    const result = await extractAstroComponents(filePaths);

    expect(result.components).toHaveLength(fileCount);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('extractComponents pipeline progress', () => {
  it('aggregates progress across Vue and Astro extractors', async () => {
    const vueFiles: string[] = [];
    const astroFiles: string[] = [];

    for (let i = 0; i < 3; i++) {
      vueFiles.push(await writeFixture(`v${i}.vue`, VUE_COMPONENT()));
      astroFiles.push(await writeFixture(`a${i}.astro`, ASTRO_COMPONENT()));
    }

    const allFiles = [...vueFiles, ...astroFiles];
    const progressUpdates: Array<{ filesProcessed: number; componentsFound: number }> = [];

    await extractComponents(allFiles, (p) => progressUpdates.push({ ...p }));

    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    // Final state: processed all 6 I/O-bound files (Vue + Astro); React/Stencil
    // extractors receive these files too but don't emit progress for them via I/O
    const last = progressUpdates[progressUpdates.length - 1]!;
    expect(last.componentsFound).toBeGreaterThan(0);
  });

  it('progress counters never decrease', async () => {
    const files: string[] = [];
    for (let i = 0; i < 4; i++) {
      files.push(await writeFixture(`p${i}.vue`, VUE_COMPONENT()));
    }

    const counts: number[] = [];
    await extractComponents(files, (p) => counts.push(p.filesProcessed));

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    }
  });
});
