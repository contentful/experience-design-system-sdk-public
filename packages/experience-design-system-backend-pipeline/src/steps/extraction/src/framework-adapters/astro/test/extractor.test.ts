import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractAstroComponents } from '../extractor.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astro-ext-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeFile(filename: string, body: string): string {
  const p = join(dir, filename);
  writeFileSync(p, body);
  return p;
}

async function extractOne(filename: string, body: string) {
  const result = await extractAstroComponents([writeFile(filename, body)]);
  expect(result.components).toHaveLength(1);
  return result.components[0]!;
}

describe('extractAstroComponents props', () => {
  it('reads an interface Props with literal unions, optional members and destructured defaults', async () => {
    const component = await extractOne(
      'Button.astro',
      `---
interface Props {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: "sm" | "lg";
  disabled?: boolean;
}
const { label, variant = 'primary', size = "sm", disabled = false } = Astro.props;
---
<button class={variant} disabled={disabled}>{label}</button>
`,
    );

    expect(component).toMatchObject({ name: 'Button', framework: 'astro', slots: [] });
    expect(component.props).toEqual([
      {
        name: 'disabled',
        type: 'boolean',
        required: false,
        defaultValue: 'false',
        sourceStartLine: 6,
        sourceEndLine: 6,
      },
      { name: 'label', type: 'string', required: true, sourceStartLine: 3, sourceEndLine: 3 },
      {
        name: 'size',
        type: '"sm" | "lg"',
        required: false,
        allowedValues: ['lg', 'sm'],
        defaultValue: 'sm',
        sourceStartLine: 5,
        sourceEndLine: 5,
      },
      {
        name: 'variant',
        type: "'primary' | 'secondary' | 'ghost'",
        required: false,
        allowedValues: ['ghost', 'primary', 'secondary'],
        defaultValue: 'primary',
        sourceStartLine: 4,
        sourceEndLine: 4,
      },
    ]);
  });

  it('keeps a prop required only when both the declaration and the binding require it', async () => {
    const component = await extractOne(
      'Card.astro',
      `---
interface Props {
  title: string;
  subtitle?: string;
}
const { title } = Astro.props;
---
<h2>{title}</h2>
`,
    );

    expect(component.props.map(({ name, required }) => ({ name, required }))).toEqual([
      { name: 'subtitle', required: false },
      { name: 'title', required: true },
    ]);
  });

  it('reads a type alias Props through the type checker', async () => {
    const component = await extractOne(
      'Badge.astro',
      `---
type Base = { tone: 'info' | 'warn' };
type Props = Base & { count?: number };
const { tone, count = 0 } = Astro.props as Props;
---
<span class={tone}>{count}</span>
`,
    );

    expect(
      component.props.map(({ name, type, required, allowedValues, defaultValue }) => ({
        name,
        type,
        required,
        allowedValues,
        defaultValue,
      })),
    ).toEqual([
      { name: 'count', type: 'number', required: false, allowedValues: undefined, defaultValue: '0' },
      {
        name: 'tone',
        type: '"info" | "warn"',
        required: true,
        allowedValues: ['info', 'warn'],
        defaultValue: undefined,
      },
    ]);
  });

  it('falls back to untyped destructured Astro.props bindings, using the source key for renamed bindings', async () => {
    const component = await extractOne(
      'Hero.astro',
      `---
const { heading: title, tagline = 'Welcome', ...rest } = Astro.props;
const { notAProp } = someOtherObject;
---
<section {...rest}><h1>{title}</h1><p>{tagline}</p></section>
`,
    );

    expect(component.props).toEqual([
      { name: 'heading', type: 'any', required: true },
      { name: 'tagline', type: 'any', required: false, defaultValue: 'Welcome' },
    ]);
  });

  it('does not read props from a template-only file', async () => {
    const component = await extractOne('Divider.astro', '<hr class="divider" />\n');

    expect(component.props).toEqual([]);
    expect(component.slots).toEqual([]);
  });

  it('treats a file without a closing fence as template only', async () => {
    const component = await extractOne(
      'Broken.astro',
      `---
const { label } = Astro.props;
<slot name="footer" />
`,
    );

    expect(component.props).toEqual([]);
    expect(component.slots).toEqual([{ name: 'footer', isDefault: false }]);
  });
});

describe('extractAstroComponents slots', () => {
  it('collects default and named template slots once each, then frontmatter-rendered slots', async () => {
    const component = await extractOne(
      'Layout.astro',
      `---
const hasAside = Astro.slots.has('aside');
const aside = await Astro.slots.render('aside');
const footer = await Astro.slots.render( "footer" );
---
<header><slot name="header" /></header>
<main><slot /></main>
<main><slot></slot></main>
<aside set:html={aside} />
<slot name='header'/>
`,
    );

    expect(component.slots).toEqual([
      { name: 'header', isDefault: false },
      { name: 'default', isDefault: true },
      { name: 'aside', isDefault: false },
      { name: 'footer', isDefault: false },
    ]);
  });

  it('keeps the template entry when a slot is both declared and rendered', async () => {
    const component = await extractOne(
      'Panel.astro',
      `---
const body = await Astro.slots.render('default');
---
<div><slot /></div>
`,
    );

    expect(component.slots).toEqual([{ name: 'default', isDefault: true }]);
  });
});

describe('extractAstroComponents file handling', () => {
  it('ignores non-Astro files and sorts components by name', async () => {
    const result = await extractAstroComponents([
      writeFile('Zeta.astro', '<div />'),
      writeFile('Alpha.astro', '<div />'),
      writeFile('Alpha.tsx', 'export const Alpha = () => null;'),
    ]);

    expect(result.components.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    expect(result.warnings).toEqual([]);
  });

  it('reports an unreadable file as a warning and keeps the other components', async () => {
    const missing = join(dir, 'Missing.astro');
    const result = await extractAstroComponents([missing, writeFile('Ok.astro', '<div />')]);

    expect(result.components.map((c) => c.name)).toEqual(['Ok']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`Failed to extract from ${missing}:`);
  });

  it('returns an empty result when no Astro files are given', async () => {
    const result = await extractAstroComponents([]);

    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
