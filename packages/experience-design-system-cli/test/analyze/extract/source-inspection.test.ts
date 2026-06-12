import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON,
  ZERO_SURFACE_RENDERED_UI_REASON,
  inspectComponentSource,
} from '../../../src/analyze/extract/source-inspection.js';
import type { RawComponentDefinition } from '../../../src/types.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeComponent(overrides: Partial<RawComponentDefinition>): RawComponentDefinition {
  return {
    name: 'Sample',
    source: '/tmp/sample.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('inspectComponentSource', () => {
  it('flags fetch-and-forward gql wrappers with high confidence', async () => {
    const dir = await createTempDir('wrapper-inspection-');
    const file = join(dir, 'ctf-hero-banner-gql.tsx');
    await writeFile(
      file,
      `
import { useContentfulLiveUpdates } from '@contentful/live-preview/react';
import { useCtfHeroBannerQuery } from './__generated/ctf-hero-banner.generated';
import { CtfHeroBanner } from './ctf-hero-banner';

export const CtfHeroGql = ({ id, locale, preview }) => {
  const { data, isLoading } = useCtfHeroBannerQuery({ id, locale, preview });
  const hero = useContentfulLiveUpdates(data?.componentHeroBanner);
  if (!hero || isLoading) return null;
  return <CtfHeroBanner {...hero} />;
};
`,
      'utf8',
    );

    const result = await inspectComponentSource(
      makeComponent({
        name: 'CtfHeroGql',
        source: file,
        props: [
          { name: 'id', type: 'string', required: true },
          { name: 'locale', type: 'string', required: true },
          { name: 'preview', type: 'boolean', required: true },
        ],
      }),
    );

    expect(result.wrapperConfidence).toBeGreaterThanOrEqual(4);
    expect(result.reviewReasons).toContain(HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON);
    expect(result.reviewReasons).toContain('data-wrapper:generated-query-hook');
    expect(result.reviewReasons).toContain('data-wrapper:sibling-renderer-import');
    expect(result.reviewReasons).toContain('data-wrapper:fetch-forward-render');
    expect(result.reviewReasons).toContain('data-wrapper:infra-props');
    expect(result.keepDespiteZeroSurface).toBe(false);
  });

  it('retains zero-surface components that still render compositional UI', async () => {
    const dir = await createTempDir('zero-surface-ui-');
    const file = join(dir, 'ctf-page.tsx');
    await writeFile(
      file,
      `
import React from 'react';
import { ComponentResolver } from './component-resolver';
import { PageContainer } from './page-container';

const CtfPage = (props) => {
  return (
    <PageContainer>
      {props.topSection?.map((entry) => (
        <ComponentResolver key={entry.sys.id} componentProps={entry} />
      ))}
    </PageContainer>
  );
};

export default CtfPage;
`,
      'utf8',
    );

    const result = await inspectComponentSource(
      makeComponent({
        name: 'CtfPage',
        source: file,
      }),
    );

    expect(result.keepDespiteZeroSurface).toBe(true);
    expect(result.reviewReasons).toContain(ZERO_SURFACE_RENDERED_UI_REASON);
    expect(result.wrapperConfidence).toBeLessThan(3);
  });
});
