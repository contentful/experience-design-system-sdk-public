import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { extractEndpoint } from '../../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('extractEndpoint', () => {
  it.each([
    {
      fileName: 'Field.tsx',
      source: `export function Field({ name, className, label, onChange }: { name: string; className: string; label: string; onChange: () => void }) {
        return <input name={name} className={className} aria-label={label} onChange={onChange} />;
      }`,
      names: ['className', 'label', 'name'],
      domName: true,
    },
    {
      fileName: 'Field.vue',
      source: `<script setup lang="ts">
        defineProps<{ name: string; modelValue: string; label: string }>();
      </script>
      <template><input :name="name" :value="modelValue" :aria-label="label" /></template>`,
      names: ['label', 'modelValue', 'name'],
      domName: undefined,
    },
  ])(
    'retains DOM-named props through extraction, classification and validation for $fileName',
    async ({ fileName, source, names, domName }) => {
      const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-dom-props-'));
      tempDirs.push(projectRoot);
      const sourcePath = join(projectRoot, fileName);
      await writeFile(sourcePath, source);

      const result = await extractEndpoint({ filePaths: [sourcePath], projectRoot });

      expect(result.components).toHaveLength(1);
      expect(result.components[0]?.props.map((prop) => prop.name).sort()).toEqual(names);
      expect(result.components[0]?.props.every((prop) => prop.category === 'content')).toBe(true);
      expect(result.components[0]?.props.find((prop) => prop.name === 'name')?.domAttribute).toBe(domName);
      expect(result.components[0]?.validationIssues).toEqual([]);
    },
  );

  it('returns validated components and typed progress without owning persistence', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'Button.tsx');
    await writeFile(
      sourcePath,
      'export function Button({ label }: { label: string }) { return <button>{label}</button>; }',
    );
    const progress: Array<{
      phase: 'extract';
      filesProcessed: number;
      totalFiles: number;
      componentsFound: number;
    }> = [];

    const result = await extractEndpoint({
      filePaths: [sourcePath],
      projectRoot,
      onProgress: (update) => progress.push(update),
    });

    expect(result.warnings).toEqual([]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: 'Button',
      source: sourcePath,
      validationIssues: [],
    });
    expect(progress.at(-1)).toEqual({
      phase: 'extract',
      filesProcessed: 1,
      totalFiles: 1,
      componentsFound: 1,
    });
  });

  it('preserves endpoint ordering for classification, review, and validation', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-contract-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'Card.tsx');
    await writeFile(
      sourcePath,
      `export function Card({ label, variant, payload, onClick }: { label: string; variant?: string; payload: any; onClick?: () => void }) {
        return <button onClick={onClick}>{label}</button>;
      }`,
    );

    const result = await extractEndpoint({
      filePaths: [sourcePath],
      projectRoot,
    });
    const card = result.components[0];

    expect(card?.props.map((prop) => prop.name)).toEqual(['label', 'payload', 'variant']);
    expect(card?.props.find((prop) => prop.name === 'label')).toEqual(
      expect.objectContaining({ category: 'content', type: 'string' }),
    );
    expect(card?.props.find((prop) => prop.name === 'variant')).toEqual(
      expect.objectContaining({ category: 'design', type: 'string' }),
    );
    expect(card?.props.find((prop) => prop.name === 'onClick')).toBeUndefined();
    expect(card).toEqual(
      expect.objectContaining({
        needsReview: false,
        validationIssues: [],
      }),
    );
    expect(card).not.toHaveProperty('extractionConfidence');
    expect(card?.reviewReasons).toEqual([]);
  });

  it('preserves non-authorable signals as reviewable output instead of silently dropping components', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-review-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'AnalyticsBridge.tsx');
    await writeFile(
      sourcePath,
      'export function AnalyticsBridge({ onTrack }: { onTrack: () => void }) { return null; }',
    );

    const result = await extractEndpoint({
      filePaths: [sourcePath],
      projectRoot,
    });

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.needsReview).toBe(true);
    expect(result.components[0]?.validationIssues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'EMPTY_COMPONENT' }),
    );
    expect(result.components[0]?.reviewReasons).toContain('non-authorable:component has no props and no slots');
    expect(result.warnings).toContain(
      'AnalyticsBridge: requires operator review (component has no props and no slots)',
    );
  });

  it('preserves extractor warnings in the endpoint response', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'extraction-endpoint-warnings-'));
    tempDirs.push(projectRoot);
    const sourcePath = join(projectRoot, 'NoScript.svelte');
    await writeFile(sourcePath, '<h1>Visible content</h1>');

    const result = await extractEndpoint({
      filePaths: [sourcePath],
      projectRoot,
    });

    expect(result.warnings).toContainEqual(expect.stringContaining('no instance script block'));
  });

  it('rejects malformed endpoint input before invoking extraction', async () => {
    await expect(extractEndpoint({ filePaths: ['   '] })).rejects.toThrow(
      'extractEndpoint requires filePaths to contain non-empty strings',
    );
  });

  it('rejects invalid endpoint options before invoking extraction', async () => {
    await expect(
      extractEndpoint({
        filePaths: [],
        resolveUnreachable: 'invalid' as never,
      }),
    ).rejects.toThrow("extractEndpoint requires resolveUnreachable to be 'auto', 'always', or 'never'");
    await expect(extractEndpoint({ filePaths: [], onProgress: 'invalid' as never })).rejects.toThrow(
      'extractEndpoint requires onProgress to be a function when provided',
    );
  });
});
