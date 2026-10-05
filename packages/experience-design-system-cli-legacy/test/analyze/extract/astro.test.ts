import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractAstroComponents } from '@contentful/experience-design-system-extraction';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(filename: string, content: string): Promise<string> {
  const filePath = join(tempDir, filename);
  await writeFile(filePath, content);
  return filePath;
}

describe('AstroComponentExtractor', () => {
  it('extracts Props interface from frontmatter', async () => {
    const filePath = await writeFixture(
      'Hero.astro',
      `---
interface Props {
  title: string;
  subtitle?: string;
}
const { title, subtitle = 'Welcome' } = Astro.props;
---
<section><h1>{title}</h1><p>{subtitle}</p></section>
    `,
    );

    const result = await extractAstroComponents([filePath]);
    expect(result.components).toHaveLength(1);
    const hero = result.components[0];
    expect(hero.name).toBe('Hero');
    expect(hero.framework).toBe('astro');

    expect(hero.props.find((p) => p.name === 'title')).toEqual(
      expect.objectContaining({ type: 'string', required: true }),
    );
    expect(hero.props.find((p) => p.name === 'subtitle')).toEqual(
      expect.objectContaining({
        type: 'string',
        required: false,
        defaultValue: 'Welcome',
      }),
    );
    expect(hero.props.find((p) => p.name === 'title')!.required).toBe(true);
    expect(hero.props.find((p) => p.name === 'subtitle')!.required).toBe(false);
    expect(hero.props.find((p) => p.name === 'subtitle')!.defaultValue).toBe('Welcome');
  });

  it('extracts named and default slots from template', async () => {
    const filePath = await writeFixture(
      'Layout.astro',
      `---
---
<div>
  <slot />
  <slot name="sidebar" />
</div>
    `,
    );

    const result = await extractAstroComponents([filePath]);
    const layout = result.components[0];
    expect(layout.slots).toContainEqual({ name: 'default', isDefault: true });
    expect(layout.slots).toContainEqual({ name: 'sidebar', isDefault: false });
  });

  it('extracts the default slot from Astro.slots.render calls in frontmatter', async () => {
    const filePath = await writeFixture(
      'AnchorHeading.astro',
      `---
const headingHtml = await Astro.slots.render('default');
---
<h2 set:html={headingHtml} />
    `,
    );

    const result = await extractAstroComponents([filePath]);
    const anchorHeading = result.components[0];
    expect(anchorHeading.slots).toContainEqual({
      name: 'default',
      isDefault: true,
    });
  });

  it('falls back to helper-return destructured props when imported Props types are unresolved', async () => {
    const filePath = await writeFixture(
      'Badge.astro',
      `---
import { BadgeComponentSchema, type BadgeComponentProps } from '../schemas/badge';
import { parseWithFriendlyErrors } from '../utils/error-map';
import type { HTMLAttributes } from 'astro/types';

type Props = BadgeComponentProps & HTMLAttributes<'span'>;

const {
  text,
  variant,
  size,
  class: customClass,
  ...attrs
} = parseWithFriendlyErrors(
  BadgeComponentSchema,
  Astro.props,
  'Invalid prop passed to the <Badge/> component.'
);
---
<span class:list={[variant, size, customClass]} {...attrs}>{text}</span>
    `,
    );

    const result = await extractAstroComponents([filePath]);
    const badge = result.components[0];
    expect(badge.props.map((prop) => prop.name)).toEqual(['class', 'size', 'text', 'variant']);
    expect(badge.slots).toEqual([]);
  });

  it('handles template-only components with no frontmatter', async () => {
    const filePath = await writeFixture('Spacer.astro', `<div class="spacer" />`);

    const result = await extractAstroComponents([filePath]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].props).toHaveLength(0);
  });

  it('does not treat template content fences as Astro frontmatter fences', async () => {
    const filePath = await writeFixture(
      'Divider.astro',
      `<div>---</div>
<slot name="before" />
<div>---</div>
<slot name="after" />
    `,
    );

    const result = await extractAstroComponents([filePath]);
    const divider = result.components[0];

    expect(divider.props).toEqual([]);
    expect(divider.slots).toContainEqual({ name: 'before', isDefault: false });
    expect(divider.slots).toContainEqual({ name: 'after', isDefault: false });
  });

  it('captures sourcePath and per-prop source line ranges (Feature 1)', async () => {
    // Note: line numbers are relative to the parsed frontmatter chunk, not the full .astro file.
    const filePath = await writeFixture(
      'HeroLoc.astro',
      `---
interface Props {
  title: string;
  subtitle?: string;
}
---
<section />
`,
    );
    const result = await extractAstroComponents([filePath]);
    const hero = result.components[0];
    expect(hero.sourcePath).toBe(filePath);
    const titleProp = hero.props.find((p) => p.name === 'title');
    const subtitleProp = hero.props.find((p) => p.name === 'subtitle');
    expect(titleProp?.sourceStartLine).toBeGreaterThan(0);
    expect(subtitleProp?.sourceStartLine).toBeGreaterThan(titleProp!.sourceStartLine!);
  });
});
