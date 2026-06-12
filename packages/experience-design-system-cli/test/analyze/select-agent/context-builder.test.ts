import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildRepoContextIndex,
  buildSelectionContext,
  summarizeSelectionContext,
} from '../../../src/analyze/select-agent/context-builder.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];

async function createTempRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'selection-context-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('selection context builder', () => {
  it('collects bounded component context from the provided repo root', async () => {
    const root = await createTempRepo();

    await mkdir(join(root, 'src/components'), { recursive: true });
    await mkdir(join(root, 'src/__generated'), { recursive: true });
    await mkdir(join(root, 'src/pages'), { recursive: true });

    await writeFile(
      join(root, 'src/components/HeroBannerGql.tsx'),
      `import { HeroBanner } from './HeroBanner';
import { useHeroBannerQuery } from '../__generated/useHeroBannerQuery';

export function HeroBannerGql({ id }: { id: string }) {
  const { data } = useHeroBannerQuery({ id });
  if (!data?.heroBanner) return null;
  return <HeroBanner {...data.heroBanner} />;
}
`,
      'utf8',
    );
    await writeFile(
      join(root, 'src/components/HeroBanner.tsx'),
      `export function HeroBanner({ title, body }: { title: string; body: string }) {
  return <section><h1>{title}</h1><p>{body}</p></section>;
}
`,
      'utf8',
    );
    await writeFile(
      join(root, 'src/components/registry.ts'),
      `import { HeroBannerGql } from './HeroBannerGql';

export const componentRegistry = {
  hero: HeroBannerGql,
};
`,
      'utf8',
    );
    await writeFile(
      join(root, 'src/pages/Home.tsx'),
      `import { HeroBannerGql } from '../components/HeroBannerGql';

export function Home() {
  return <HeroBannerGql id="hero-1" />;
}
`,
      'utf8',
    );
    await writeFile(
      join(root, 'src/__generated/useHeroBannerQuery.ts'),
      `export function useHeroBannerQuery() {
  return { data: { heroBanner: { title: 'Hero', body: 'Body copy' } } };
}
`,
      'utf8',
    );
    await writeFile(
      join(root, 'outside.tsx'),
      `export function Outside() {
  return null;
}
`,
      'utf8',
    );

    const filePaths = [
      join(root, 'src/components/HeroBannerGql.tsx'),
      join(root, 'src/components/HeroBanner.tsx'),
      join(root, 'src/components/registry.ts'),
      join(root, 'src/pages/Home.tsx'),
      join(root, 'src/__generated/useHeroBannerQuery.ts'),
      join(root, 'outside.tsx'),
    ];

    const index = await buildRepoContextIndex(root, filePaths);
    expect(index).not.toBeNull();

    const component: RawComponentDefinition = {
      name: 'HeroBannerGql',
      source: 'src/components/HeroBannerGql.tsx',
      framework: 'react',
      props: [{ name: 'id', type: 'string', required: true }],
      slots: [],
    };

    const context = buildSelectionContext(index!, component);
    expect(context).toBeDefined();
    expect(context?.componentFile.path).toBe('src/components/HeroBannerGql.tsx');
    expect(context?.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: './HeroBanner',
          resolvedPath: 'src/components/HeroBanner.tsx',
        }),
      ]),
    );
    expect(context?.siblingFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/components/HeroBanner.tsx',
        }),
      ]),
    );
    expect(context?.resolverReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/components/registry.ts',
        }),
      ]),
    );
    expect(context?.parentUsageSite).toMatchObject({
      path: 'src/pages/Home.tsx',
    });
    expect(summarizeSelectionContext(context)).toMatchObject({
      boundaryRoot: root,
      siblingFileCount: 2,
      resolverReferenceCount: 1,
      hasParentUsageSite: true,
    });
  });

  it('does not build context for a component outside the provided root', async () => {
    const root = await createTempRepo();
    await writeFile(join(root, 'some-file.tsx'), '// placeholder', 'utf8');
    const index = await buildRepoContextIndex(root, [join(root, 'some-file.tsx')]);

    const component: RawComponentDefinition = {
      name: 'ForeignComponent',
      source: '/tmp/foreign/Component.tsx',
      framework: 'react',
      props: [],
      slots: [],
    };

    expect(index).not.toBeNull();
    expect(buildSelectionContext(index!, component)).toBeUndefined();
  });
});
