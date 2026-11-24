import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractWebComponentDefinitions } from '../../../../../../src/steps/extraction/src/framework-adapters/web-components/extractor.js';
import type { SourceSyntaxObservation } from '../../../../../../src/steps/extraction/src/candidates/types.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture(files: Record<string, string>) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'wc-discovery-')));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
  return { directory, files: Object.keys(files).map((name) => join(directory, name)) };
}

async function extract(files: Record<string, string>) {
  const { files: paths, directory } = fixture(files);
  const result = await extractWebComponentDefinitions(paths, undefined, { projectRoot: directory });
  return { result, directory };
}

function summary(result: Awaited<ReturnType<typeof extractWebComponentDefinitions>>) {
  return result.components.map((component) => ({
    name: component.name,
    file: component.source.split('/').pop(),
  }));
}

function syntaxOf(
  result: Awaited<ReturnType<typeof extractWebComponentDefinitions>>,
  component: string,
  prop: string,
): Extract<SourceSyntaxObservation, { reader: 'web-component' }> | undefined {
  const syntax = result.components
    .find((item) => item.name === component)
    ?.sourceCandidates?.find((candidate) => candidate.name === prop)
    ?.observations.find((observation) => observation.evidenceKind === 'declaration')?.syntax;
  return syntax?.reader === 'web-component' ? syntax : undefined;
}

const FAST_DIALOG = `import { FASTElement, customElement, attr, html, observable } from '@microsoft/fast-element';
const template = html<AcmeDialog>\`<div role="dialog"><slot name="title"></slot><slot></slot><slot name="actions"></slot></div>\`;
@customElement({ name: 'acme-dialog', template })
export class AcmeDialog extends FASTElement {
  @attr({ mode: 'boolean' }) open = false;
  @attr({ attribute: 'close-label' }) closeLabel = 'Close';
  @attr modal: 'true' | 'false' = 'true';
  @observable items: string[] = [];
}`;

describe('FAST element definitions', () => {
  it('discovers a decorator options object with a template held in a separate const', async () => {
    const { result } = await extract({ 'dialog.ts': FAST_DIALOG });
    const dialog = result.components.find((component) => component.name === 'AcmeDialog');
    expect(dialog).toBeDefined();
    expect(dialog!.props.map((prop) => prop.name)).toEqual(['closeLabel', 'items', 'modal', 'open']);
    expect(dialog!.props.find((prop) => prop.name === 'open')).toMatchObject({
      type: 'boolean',
      defaultValue: 'false',
    });
    expect(dialog!.props.find((prop) => prop.name === 'modal')).toMatchObject({ allowedValues: ['true', 'false'] });
    expect(dialog!.slots).toEqual([
      expect.objectContaining({ name: 'actions', isDefault: false }),
      expect.objectContaining({ name: 'default', isDefault: true }),
      expect.objectContaining({ name: 'title', isDefault: false }),
    ]);
    expect(
      dialog!.sourceCandidates!.filter((candidate) => candidate.observations.some((item) => item.type === 'slot')),
    ).toHaveLength(3);
  });

  it('reads FAST attribute names, modes and converters, and keeps observables as property-only props', async () => {
    const { result } = await extract({
      'dialog.ts': FAST_DIALOG.replace(
        '@observable items',
        `@attr({ mode: 'fromView' }) tone = 'neutral';
  @attr({ mode: 'reflect', converter: nullableNumberConverter }) count;
  @attr({ mode: 'boolean' }) dismissible;
  @observable items`,
      ),
    });
    expect(syntaxOf(result, 'AcmeDialog', 'closeLabel')?.attribute).toEqual({ state: 'explicit', name: 'close-label' });
    expect(syntaxOf(result, 'AcmeDialog', 'modal')?.attribute).toEqual({ state: 'implicit', name: 'modal' });
    expect(syntaxOf(result, 'AcmeDialog', 'open')?.reflect).toEqual({ state: 'explicit', value: true });
    expect(syntaxOf(result, 'AcmeDialog', 'tone')?.reflect).toEqual({ state: 'explicit', value: false });
    expect(syntaxOf(result, 'AcmeDialog', 'count')?.converter).toEqual({
      state: 'known',
      expression: 'nullableNumberConverter',
    });
    const props = result.components[0]!.props;
    expect(props.find((prop) => prop.name === 'count')?.type).toBe('number');
    expect(props.find((prop) => prop.name === 'dismissible')?.type).toBe('boolean');
    expect(props.find((prop) => prop.name === 'items')).toMatchObject({ type: 'string[]' });
    expect(syntaxOf(result, 'AcmeDialog', 'items')?.attribute).toEqual({ state: 'absent', name: null });
  });

  it('keeps an unknown FAST mode and a custom converter as unknown metadata', async () => {
    const { result } = await extract({
      'dialog.ts': FAST_DIALOG.replace(
        '@observable items',
        `@attr({ mode: someMode }) tone = 'neutral';
  @attr({ converter: customConverter }) count = 0;
  @observable items`,
      ),
    });
    expect(syntaxOf(result, 'AcmeDialog', 'tone')?.reflect).toEqual({ state: 'unknown', value: null });
    expect(syntaxOf(result, 'AcmeDialog', 'count')?.converter).toEqual({
      state: 'unknown',
      expression: 'customConverter',
    });
    expect(result.components[0]!.props.find((prop) => prop.name === 'count')?.type).toBe('number');
  });

  it.each([
    [
      'FAST 2 static define with options',
      `export class AcmeTag extends FASTElement { label = ''; }
       AcmeTag.define({ name: 'acme-tag', template: html\`<slot name="icon"></slot><slot></slot>\` });`,
    ],
    [
      'FAST 1 FASTElement.define with options',
      `export class AcmeTag extends FASTElement { label = ''; }
       FASTElement.define(AcmeTag, { name: 'acme-tag', template: tagTemplate });
       const tagTemplate = html\`<slot name="icon"></slot><slot></slot>\`;`,
    ],
    [
      'FAST 1 FASTElement.define with a name',
      `export class AcmeTag extends FASTElement { label = ''; }
       FASTElement.define(AcmeTag, 'acme-tag');`,
    ],
    [
      'same-file compose with a name',
      `export class AcmeTag extends FoundationElement { label = ''; }
       export const acmeTag = AcmeTag.compose({ baseName: 'acme-tag', template: html\`<slot name="icon"></slot><slot></slot>\` });`,
    ],
    [
      'decorator with a const options object',
      `const definition = { name: 'acme-tag', template: html\`<slot name="icon"></slot><slot></slot>\` };
       @customElement(definition)
       export class AcmeTag extends FASTElement { label = ''; }`,
    ],
  ])('discovers %s', async (label, source) => {
    const { result } = await extract({
      'tag.ts': `import { FASTElement, FoundationElement, customElement, html } from '@microsoft/fast-element';\n${source}`,
    });
    expect(summary(result)).toEqual([{ name: 'AcmeTag', file: 'tag.ts' }]);
    expect(result.components[0]!.props.map((prop) => prop.name)).toEqual(['label']);
    if (label !== 'FAST 1 FASTElement.define with a name')
      expect(result.components[0]!.slots.map((slot) => slot.name)).toEqual(['default', 'icon']);
  });

  it.each([
    ['an options object without a name', `@customElement({ template: html\`<slot></slot>\` })`],
    ['a computed name', `@customElement({ name: computeName() })`],
    ['a spread options object', `@customElement({ ...shared })`],
  ])('does not discover a decorator with %s', async (_label, decorator) => {
    const { result } = await extract({
      'tag.ts': `import { FASTElement, customElement, html } from '@microsoft/fast-element';
        ${decorator}
        export class AcmeTag extends FASTElement { label = ''; }`,
    });
    expect(result.components).toEqual([]);
  });
});

describe('tag names from constants and static fields', () => {
  it('resolves a Lit decorator tag held in a local or imported const', async () => {
    const { result } = await extract({
      'tags.ts': `export const CHIP_TAG = 'acme-chip';`,
      'chip.ts': `import { LitElement } from 'lit'; import { customElement } from 'lit/decorators.js';
        import { CHIP_TAG } from './tags';
        @customElement(CHIP_TAG) export class AcmeChip extends LitElement { label = ''; }`,
      'pill.ts': `import { LitElement } from 'lit'; import { customElement } from 'lit/decorators.js';
        const TAG = 'acme-pill';
        @customElement(TAG) export class AcmePill extends LitElement { label = ''; }`,
    });
    expect(summary(result)).toEqual([
      { name: 'AcmeChip', file: 'chip.ts' },
      { name: 'AcmePill', file: 'pill.ts' },
    ]);
  });

  it.each([
    ['window.customElements', `window.customElements.define('acme-note', AcmeNote);`],
    ['globalThis.customElements', `globalThis.customElements.define('acme-note', AcmeNote);`],
    [
      'a guarded define with a const tag',
      `const tag = 'acme-note'; if (!customElements.get(tag)) customElements.define(tag, AcmeNote);`,
    ],
    ['a static tagName field', `customElements.define(AcmeNote.tagName, AcmeNote);`],
    ['a static is getter', `customElements.define(AcmeNote.is, AcmeNote);`],
    ['a Polymer-style defineCustomElement', `defineCustomElement(AcmeNote);`],
    ['a defineElement helper', `defineElement('acme-note', AcmeNote);`],
    ['a scoped registry', `const registry = new CustomElementRegistry(); registry.define('acme-note', AcmeNote);`],
  ])('discovers a registration through %s', async (_label, registration) => {
    const { result } = await extract({
      'note.ts': `export class AcmeNote extends HTMLElement {
          static tagName = 'acme-note';
          static get is() { return 'acme-note'; }
          label = '';
        }
        ${registration}`,
    });
    expect(summary(result)).toEqual([{ name: 'AcmeNote', file: 'note.ts' }]);
    expect(result.components[0]!.props.map((prop) => prop.name)).toEqual(['label']);
  });

  it.each([
    ['a computed tag', `customElements.define(computeTag(), AcmeNote);`],
    ['a missing static field', `customElements.define(AcmeNote.missing, AcmeNote);`],
    ['a conditional static getter', `customElements.define(AcmeNote.conditional, AcmeNote);`],
    ['a define on a class with no base', `Registry.define('acme-note');`],
    ['a tag without a hyphen', `AcmeNote.define('note');`],
  ])('does not discover a registration with %s', async (_label, registration) => {
    const { result } = await extract({
      'note.ts': `export class AcmeNote extends HTMLElement {
          static get conditional() { if (flag) return 'acme-a'; return 'acme-b'; }
          label = '';
        }
        export class Registry { static define(name: string) { return name; } }
        ${registration}`,
    });
    expect(result.components).toEqual([]);
  });

  it('uses the base-class static define in the same file', async () => {
    const { result } = await extract({
      'note.ts': `export class AcmeNote extends AcmeElement { label = ''; }
        AcmeNote.define('acme-note');`,
    });
    expect(summary(result)).toEqual([{ name: 'AcmeNote', file: 'note.ts' }]);
  });
});

describe('registrations outside the class file', () => {
  it('discovers a class registered from a separate file once, from the class file', async () => {
    const { result, directory } = await extract({
      'src/Note.ts': `export class Note extends HTMLElement { label = ''; }`,
      'src/Tag.ts': `export class Tag extends HTMLElement { tone = ''; }`,
      'acme-note.ts': `import { Note } from './src/Note.js'; customElements.define('acme-note', Note);`,
      'acme-tag.ts': `import { defineElement } from './define'; import { Tag } from './src/Tag'; defineElement('acme-tag', Tag);`,
      'define.ts': `export function defineElement(name: string, element: CustomElementConstructor) { customElements.define(name, element); }`,
    });
    expect(summary(result)).toEqual([
      { name: 'Note', file: 'Note.ts' },
      { name: 'Tag', file: 'Tag.ts' },
    ]);
    expect(result.components[0]!.source).toBe(join(directory, 'src/Note.ts'));
  });

  it('does not discover a registration whose class cannot be resolved', async () => {
    const { result } = await extract({
      'acme-note.ts': `import { Note } from './src/Missing.js'; customElements.define('acme-note', Note);`,
    });
    expect(result.components).toEqual([]);
  });

  it('discovers a class expression passed directly to define, named from the tag', async () => {
    const { result } = await extract({
      'inline.ts': `customElements.define('acme-inline-note', class extends HTMLElement { label = ''; });
        customElements.define('acme-named-note', class NamedNote extends HTMLElement { tone = ''; });`,
    });
    expect(summary(result)).toEqual([
      { name: 'AcmeInlineNote', file: 'inline.ts' },
      { name: 'NamedNote', file: 'inline.ts' },
    ]);
    expect(result.components.find((component) => component.name === 'AcmeInlineNote')!.props).toEqual([
      expect.objectContaining({ name: 'label', type: 'string' }),
    ]);
  });
});
