import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractAngularComponents } from '../../../src/steps/extraction/src/framework-adapters/angular/extract-angular-components.js';
import {
  getOrCreateSession,
  loadRawComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../../src/persistence/src/session/repositories/db.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'angular-input-retention-'));
  roots.push(root);
  const path = join(root, 'example.ts');
  writeFileSync(path, source);
  return { root, path };
}

it.each([
  'TemplateRef<string>',
  'TemplateRef<string> | null',
  'string | TemplateRef<string> | null',
  '{ value: TemplateRef<string> }',
  'TemplateRef<string>[]',
  'Array<TemplateRef<{ value: string }>>',
])('preserves renamed custom inputs without assigning slot behavior from their domain: %s', async (type) => {
  const { path } = fixture(`
    import { Component, Input } from '@angular/core';
    type TemplateRef<T> = { value: T };
    @Component({ selector: 'app-example', template: '' })
    export class Example {
      @Input({ required: true }) title!: ${type};
      @Input({ required: true }) unusual!: ${type};
      local!: ${type};
    }
  `);
  const { components, warnings } = await extractAngularComponents([path]);
  expect(warnings).toEqual([]);
  const component = components[0]!;
  expect(component.props.map((prop) => prop.name)).toEqual(['title', 'unusual']);
  for (const prop of component.props) {
    expect(prop).toMatchObject({ type, required: true });
    expect(prop).not.toHaveProperty('category');
    expect(prop).not.toHaveProperty('authorability');
    expect(prop.sourceStartLine).toBeGreaterThan(0);
  }
  expect(component.slots).toEqual([]);
});

it('preserves imported and renamed template domains, signal defaults and explicit projection slots after reopen', async () => {
  const { root, path } = fixture(`
    import { Component, Input, input, TemplateRef, TemplateRef as View } from '@angular/core';
    @Component({
      selector: 'app-example',
      template: '<ng-content select="[header]"></ng-content><ng-content/>',
    })
    export class Example {
      @Input('publicTitle') title: TemplateRef<void> | null = null;
      @Input() unusual: View<void> | null = null;
      readonly _value = input<TemplateRef<void> | null>(null);
      readonly payload = input.required<{ value: TemplateRef<{ label: string }> }>({ alias: '$value' });
      local: TemplateRef<void> | null = null;
    }
  `);
  const { components, warnings } = await extractAngularComponents([path]);
  expect(warnings).toEqual([]);
  const component = components[0]!;
  expect(component.props.map((prop) => prop.name)).toEqual(['publicTitle', 'unusual', '_value', '$value']);
  expect(component.props.slice(0, 3)).toEqual([
    expect.objectContaining({
      name: 'publicTitle',
      type: 'TemplateRef<void> | null',
      defaultValue: 'null',
      required: false,
    }),
    expect.objectContaining({ name: 'unusual', type: 'View<void> | null', defaultValue: 'null', required: false }),
    expect.objectContaining({
      name: '_value',
      type: 'TemplateRef<void> | null',
      defaultValue: 'null',
      required: false,
    }),
  ]);
  expect(component.props[3]).toMatchObject({
    name: '$value',
    type: '{ value: TemplateRef<{ label: string }> }',
    required: true,
  });
  expect(component.props[3]).not.toHaveProperty('defaultValue');
  expect(component.slots).toEqual([
    { name: 'header', isDefault: false },
    { name: 'children', isDefault: true },
  ]);

  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  try {
    storeRawComponents(db, sessionId, components);
  } finally {
    db.close();
  }
  rmSync(path);
  const reopened = openPipelineDb(dbPath);
  try {
    const saved = loadRawComponents(reopened, sessionId)[0]!;
    expect(saved.props).toEqual(component.props);
    expect(saved.slots).toEqual(component.slots);
  } finally {
    reopened.close();
  }
});

it.each(['booleanAttribute', 'numberAttribute', 'notbooleanAttribute', 'convertValue'])(
  'retains declared domains rather than interpreting transform names: %s',
  async (transform) => {
    const { path } = fixture(`
      import { Component, Input, input } from '@angular/core';
      function ${transform}(value: 'small' | 'large') { return value; }
      const transforms = { ${transform} };
      @Component({ selector: 'app-example', template: '' })
      export class Example {
        @Input({ transform: ${transform} }) direct: 'small' | 'large' = 'small';
        @Input({ transform: transforms.${transform} }) member: 'small' | 'large' = 'small';
        readonly signal = input<'small' | 'large'>('small', { transform: ${transform} });
        readonly required = input.required<'small' | 'large'>({ transform: transforms.${transform} });
      }
    `);
    const { components, warnings } = await extractAngularComponents([path]);
    expect(warnings).toHaveLength(4);
    for (const name of ['direct', 'member', 'signal', 'required']) {
      expect(warnings.some((warning) => warning.includes(name) && warning.includes('unresolved transform'))).toBe(true);
    }
    const component = components[0]!;
    expect(component.props.map((prop) => prop.name)).toEqual(['direct', 'member', 'signal', 'required']);
    for (const prop of component.props) {
      expect(prop).toMatchObject({ type: "'small' | 'large'", allowedValues: ['small', 'large'] });
      expect(prop.required).toBe(prop.name === 'required');
      if (prop.name === 'required') expect(prop).not.toHaveProperty('defaultValue');
      else expect(prop.defaultValue).toBe("'small'");
    }
    expect(component.slots).toEqual([]);
  },
);

it.each([
  '@ContentChild(Item) selected!: Item;',
  '@ContentChildren(Item) selected!: Item[];',
  'selected = contentChild(Item);',
  'selected = contentChildren(Item);',
  "@ContentChild('item') selected: unknown;",
])('retains content-query observations without inventing output slots from fixed markup: %s', async (query) => {
  const { path } = fixture(`
    import { Component, ContentChild, ContentChildren, contentChild, contentChildren } from '@angular/core';
    class Item {}
    @Component({ selector: 'app-example', template: '<p>fixed</p>' })
    export class Example { ${query} }
  `);
  const { components, warnings } = await extractAngularComponents([path]);
  const component = components[0]!;
  expect(component.props).toEqual([]);
  expect(component.slots).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain(query);
  expect(warnings[0]).toContain('output ownership unresolved');
});
