import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractWebComponentDefinitions } from '../../../../../../src/steps/extraction/src/framework-adapters/web-components/extractor.js';

import type { SourceSyntaxObservation } from '../../../../../../src/steps/extraction/src/candidates/types.js';
import { bindSourceCandidatesToCapture } from '../../../../../../src/steps/extraction/src/candidates/bind-source-candidates.js';

function webSyntax(syntax: SourceSyntaxObservation | undefined) {
  return syntax?.reader === 'web-component' ? syntax : undefined;
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture(files: Record<string, string>) {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'wc-candidates-')));
  directories.push(directory);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return { directory, path: join(directory, 'Element.ts') };
}

describe('WC syntax source observations', () => {
  it('uses the last explicit metadata field instead of an overwritten value', async () => {
    const { path } = fixture({
      'Element.ts': `class ExampleElement extends HTMLElement {
        @property({ attribute: 'first', attribute: 'last', reflect: true, reflect: false, type: Number, type: String }) label = '';
      } customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    const syntax = result.components[0]?.sourceCandidates?.find((item) => item.name === 'label')?.observations[0]
      ?.syntax;
    expect(syntax).toMatchObject({
      attribute: { state: 'explicit', name: 'last' },
      reflect: { state: 'explicit', value: false },
      converter: { state: 'known', expression: 'String' },
    });
  });

  it('retains declarations but reports conditional static getters as uncertain', async () => {
    const { path } = fixture({
      'Element.ts': `class ExampleElement extends HTMLElement {
        static get properties() {
          if (dynamicCondition) return { label: { attribute: 'alternate', reflect: true } };
          return { label: { type: String } };
        }
        static get observedAttributes() {
          if (dynamicCondition) return ['alternate'];
          return ['label'];
        }
        label: string = '';
      } customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    const label = result.components[0]?.sourceCandidates?.find((item) => item.name === 'label');
    expect(label?.observations[0]?.syntax).toMatchObject({
      attribute: { state: 'unknown', name: null },
      reflect: { state: 'unknown', value: null },
      converter: { state: 'unknown' },
    });
    expect(
      webSyntax(label?.observations.find((item) => item.evidenceKind === 'runtime-object')?.syntax)?.attribute.state,
    ).toBe('unknown');
    expect(result.extractionDiagnostics?.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'wc-unknown-static-properties' }),
        expect.objectContaining({ reason: 'wc-unknown-observed-attributes' }),
      ]),
    );
  });

  it('keeps declarations authoritative and converter/attribute/exposure observations independent', async () => {
    const { path } = fixture({
      'Element.ts': `
      class ExampleElement extends HTMLElement {
        @property({ type: String, attribute: 'data-mode', reflect: false }) mode: 'a' | 'b' | string = 'a';
        @state() _internal: number = 0;
        @property({ type: Boolean, attribute: false, reflect: true }) private enabled = false;
        @property({ attribute: '' }) '$value' = '';
        @property(dynamicOptions) dynamic: string = compute();
        @property({ ...options }) spread: string = '';
        @property() camelCase = '';
        'a.b/c': string = '';
        ['__proto__']: string = '';
      }
      customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    const component = result.components[0]!;
    const candidate = (name: string) => component.sourceCandidates?.find((item) => item.name === name);
    expect(component.props.find((prop) => prop.name === 'mode')?.type).toBe("'a' | 'b' | string");
    expect(candidate('mode')?.facts?.domain.openness).toBe('open');
    expect(candidate('mode')?.observations[0]?.syntax).toMatchObject({
      converter: { state: 'known', expression: 'String' },
      attribute: { state: 'explicit', name: 'data-mode' },
      reflect: { state: 'explicit', value: false },
    });
    expect(webSyntax(candidate('_internal')?.observations[0]?.syntax)?.exposure).toContain('state');
    expect(candidate('enabled')?.observations[0]?.syntax).toMatchObject({
      attribute: { state: 'disabled', name: null },
      exposure: expect.arrayContaining(['private']),
    });
    expect(webSyntax(candidate('$value')?.observations[0]?.syntax)?.attribute).toMatchObject({
      state: 'explicit',
      name: '',
    });
    expect(webSyntax(candidate('camelCase')?.observations[0]?.syntax)?.attribute).toMatchObject({
      state: 'implicit',
      name: 'camelcase',
    });
    for (const name of ['dynamic', 'spread'])
      expect(webSyntax(candidate(name)?.observations[0]?.syntax)?.attribute.state).toBe('unknown');
    expect(candidate('dynamic')?.observations[0]?.syntax?.default).toMatchObject({
      expression: 'compute()',
      state: 'unresolved',
      reason: expect.any(String),
    });
    expect(candidate('_internal')?.observations[0]?.syntax?.default).toMatchObject({
      state: 'literal',
      value: { kind: 'number', value: '0' },
    });
    expect(candidate('enabled')?.observations[0]?.syntax?.default.value).toEqual({ kind: 'boolean', value: 'false' });
    expect(candidate('$value')?.observations[0]?.syntax?.default.value).toEqual({ kind: 'string', value: '' });
    expect(candidate('a.b/c')?.keyPath).toEqual(['a.b/c']);
    expect(candidate('__proto__')?.keyPath).toEqual(['__proto__']);
  });

  it('retains enum values, default alias receipts and unresolved/cyclic alternatives without executing', async () => {
    const { path, directory } = fixture({
      'values.ts': `export enum Numeric { Zero = 0, Two = 2, Three }
export enum Text { A = 'alpha', B = 'beta' }
export const INITIAL = Numeric.Two; export const LOOP = LOOP;`,
      'Element.ts': `import { Numeric, Text, INITIAL as START, LOOP } from './values.js';
        class ExampleElement extends HTMLElement {
          @property({ type: String }) count: Numeric = START;
          text: Text = Text.A;
          open: Numeric | number = Numeric.Zero;
          loop = LOOP;
          unknown: Missing = call();
        } customElements.define('example-element', ExampleElement);`,
    });
    const component = (await extractWebComponentDefinitions([path])).components[0]!;
    const candidate = (name: string) => component.sourceCandidates?.find((item) => item.name === name);
    expect(candidate('count')?.facts?.sourceTypeText).toBe('Numeric');
    expect(candidate('count')?.facts?.domain).toEqual({
      openness: 'closed',
      observedLiterals: [
        { kind: 'number', value: '0' },
        { kind: 'number', value: '2' },
        { kind: 'number', value: '3' },
      ],
    });
    expect(candidate('text')?.facts?.domain.observedLiterals).toEqual([
      { kind: 'string', value: 'alpha' },
      { kind: 'string', value: 'beta' },
    ]);
    expect(candidate('open')?.facts?.domain.openness).toBe('open');
    expect(candidate('count')?.observations[0]?.syntax?.default).toMatchObject({
      expression: 'START',
      state: 'resolved',
      value: { kind: 'number', value: '2' },
      locations: expect.arrayContaining([expect.objectContaining({ canonicalPath: resolve(directory, 'values.ts') })]),
    });
    expect(
      candidate('count')?.observations[0]?.syntax?.default.locations.map((location) => ({
        path: location.canonicalPath,
        startLine: location.startLine,
        endLine: location.endLine,
        binding: location.binding,
      })),
    ).toEqual([
      { path, startLine: 3, endLine: 3, binding: 'unverified' },
      { path: join(directory, 'values.ts'), startLine: 3, endLine: 3, binding: 'unverified' },
      { path: join(directory, 'values.ts'), startLine: 1, endLine: 1, binding: 'unverified' },
    ]);
    expect(candidate('loop')?.observations[0]?.syntax?.default).toMatchObject({ state: 'unresolved', reason: 'cycle' });
    expect(candidate('unknown')?.facts?.domain.openness).toBe('unknown');
  });

  it('retains inherited and mixin override lineage, source locations and slots', async () => {
    const { path, directory } = fixture({
      'base.ts': `/** @slot inherited - Base content */ export class Base extends HTMLElement { title: string = 'base'; baseOnly = true; render() { return html\`<slot name="base-template"></slot>\`; } }
        export const WithLabel = (Supplied: typeof Base) => class extends Supplied { label: string = 'mixin'; };`,
      'Element.ts': `import { Base, WithLabel } from './base.js';
        class ExampleElement extends WithLabel(Base) { title: 'own' = 'own'; }
        customElements.define('example-element', ExampleElement);`,
    });
    const component = (await extractWebComponentDefinitions([path])).components[0]!;
    const title = component.sourceCandidates?.find((item) => item.name === 'title');
    expect(component.props.find((prop) => prop.name === 'title')?.type).toBe("'own'");
    expect(title?.observations).toHaveLength(2);
    expect(webSyntax(title?.observations[0]?.syntax)?.lineage).toBe('own');
    expect(webSyntax(title?.observations[1]?.syntax)?.lineage).toBe('base');
    expect(title?.facts?.certainty).toBe('ambiguous');
    expect(
      webSyntax(component.sourceCandidates?.find((item) => item.name === 'label')?.observations[0]?.syntax)?.lineage,
    ).toBe('mixin');
    expect(
      component.sourceCandidates?.find((item) => item.name === 'baseOnly')?.facts?.declarations[0]?.canonicalPath,
    ).toBe(resolve(directory, 'base.ts'));
    expect(
      webSyntax(component.sourceCandidates?.find((item) => item.name === 'base-template')?.observations[0]?.syntax)
        ?.slotKind,
    ).toBe('literal-template');
    expect(component.slots.map((slot) => slot.name)).toEqual(expect.arrayContaining(['inherited', 'base-template']));
  });

  it('bounds cyclic/dynamic bases and keeps discovered declarations with diagnostics', async () => {
    const { path } = fixture({
      'Element.ts': `class ExampleElement extends unknownFactory(Base) { label: string = 'ok'; } customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    expect(result.components[0]?.sourceCandidates?.some((item) => item.name === 'label')).toBe(true);
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'wc-unresolved-mixin' }),
    );
    expect(result.extractionDiagnostics?.coverage).toBe('partial');
  });

  it('supports registered class expressions and plain JS with configured noEmit and exact eligibility', async () => {
    const { directory } = fixture({
      'jsconfig.json': '{ "compilerOptions": { "allowJs": true, "noEmit": false } }',
      'Element.js': `const ExampleElement = class extends HTMLElement { static properties = { count: { type: Number }, hidden: { attribute: false } }; count = 0; static get observedAttributes() { return ['data-label']; } }; customElements.define('example-element', ExampleElement);`,
      'support.js': `class Support extends HTMLElement { text = ''; } customElements.define('support-element', Support);`,
    });
    const result = await extractWebComponentDefinitions([join(directory, 'Element.js')], undefined, {
      projectRoot: directory,
    });
    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.props.find((item) => item.name === 'count')?.type).toBe('number');
    expect(result.components[0]?.sourceCandidates?.map((item) => item.name)).toEqual(
      expect.arrayContaining(['count', 'hidden', 'data-label']),
    );
    expect(result.extractionDiagnostics?.projects[0]?.options.noEmit).toBe(true);
  });

  it('preserves static getter uncertainty, unknown converters and declared fallback precedence', async () => {
    const { path } = fixture({
      'Element.ts': `/** @attr {number} label - fallback */ class ExampleElement extends HTMLElement {
      static get properties() { return loadProperties(); }
      @property({ type: customConverter, reflect: unknownValue }) label: string = '';
      @property({ type: Array }) items;
      static get observedAttributes() { return ['label']; }
    } customElements.define('example-element', ExampleElement);`,
    });
    const component = (await extractWebComponentDefinitions([path])).components[0]!;
    expect(component.props.find((item) => item.name === 'label')?.type).toBe('string');
    expect(component.sourceCandidates?.find((item) => item.name === 'label')?.observations[0]?.syntax).toMatchObject({
      converter: { state: 'unknown', expression: 'customConverter' },
      reflect: { state: 'unknown', value: null },
    });
    expect(component.sourceCandidates?.find((item) => item.name === 'items')?.declaredRequired).toBeNull();
  });
  it('keeps spread overrides unknown and retains same-file override default conflicts', async () => {
    const { path } = fixture({
      'Element.ts': `class Base extends HTMLElement { label: string = 'base'; }
      class ExampleElement extends Base {
        @property({ attribute: 'unstable', reflect: true, ...options }) label: string = 'own';
        render() { return html\`<slot name="header">\${content}</slot>\`; }
      } customElements.define('example-element', ExampleElement);`,
    });
    const component = (await extractWebComponentDefinitions([path])).components[0]!;
    const label = component.sourceCandidates?.find((item) => item.name === 'label');
    expect(label?.observations[0]?.syntax).toMatchObject({
      attribute: { state: 'unknown', name: null },
      reflect: { state: 'unknown', value: null },
    });
    expect(label?.facts?.certainty).toBe('ambiguous');
    expect(label?.facts?.declarations).toHaveLength(2);
    expect(label?.sourceDefault).toBe("'own'");
    expect(
      webSyntax(component.sourceCandidates?.find((item) => item.name === 'header')?.observations[0]?.syntax)?.slotKind,
    ).toBe('literal-template');
  });

  it('terminates inheritance cycles and reports malformed config with no components', async () => {
    const { path, directory } = fixture({
      'Element.ts': `class Base extends ExampleElement { base = ''; } class ExampleElement extends Base { local = ''; } customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    expect(result.components[0]?.sourceCandidates?.map((item) => item.name)).toEqual(
      expect.arrayContaining(['base', 'local']),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'wc-inheritance-cycle' }),
    );
    writeFileSync(join(directory, 'tsconfig.json'), '{invalid');
    writeFileSync(path, 'export const value = 1;');
    const empty = await extractWebComponentDefinitions([path], undefined, { projectRoot: directory });
    expect(empty.components).toEqual([]);
    expect(empty.extractionDiagnostics?.projects[0]?.status).toBe('invalid');
  });

  it('keeps per-file default and enum receipt binding unavailable when capture has no byte proof', async () => {
    const { path } = fixture({
      'Element.ts': `class ExampleElement extends HTMLElement { value: 'a' = 'a'; } customElements.define('example-element', ExampleElement);`,
    });
    const result = await extractWebComponentDefinitions([path]);
    const bound = bindSourceCandidatesToCapture(result.components, [{ canonicalPath: path, textHash: null }]);
    const candidate = bound[0]?.sourceCandidates?.find((item) => item.name === 'value');
    expect(candidate?.observations[0]?.syntax?.default.locations[0]?.binding).toBe('unverified');
    expect(candidate?.observations[0]?.syntax?.typeLocations[0]?.binding).toBe('unverified');
    const missing = bindSourceCandidatesToCapture(result.components, []);
    expect(
      missing[0]?.sourceCandidates?.find((item) => item.name === 'value')?.observations[0]?.syntax?.default.locations[0]
        ?.binding,
    ).toBe('unavailable');
  });

  it('preserves literal helper and innerHTML slot observations with their actual file receipts', async () => {
    const { path, directory } = fixture({
      'templates.ts': 'export function content() { return html`<slot name="helper"></slot>`; }',
      'Element.ts': `import { content } from './templates.js'; class ExampleElement extends HTMLElement {
        constructor() { super(); this.innerHTML = \`<slot name="markup"></slot>\`; }
        render() { return content(); }
      } customElements.define('example-element', ExampleElement);`,
    });
    const component = (await extractWebComponentDefinitions([path])).components[0]!;
    expect(component.slots.map((slot) => slot.name)).toEqual(expect.arrayContaining(['helper', 'markup']));
    expect(
      component.sourceCandidates?.find((item) => item.name === 'helper')?.observations[0]?.location?.canonicalPath,
    ).toBe(resolve(directory, 'templates.ts'));
  });
});
