import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SourceSyntaxObservation } from '../../../src/steps/extraction/src/candidates/types.js';
import { extractWebComponentDefinitions } from '../../../src/steps/extraction/src/framework-adapters/web-components/extract-web-components.js';

function webSyntax(syntax: SourceSyntaxObservation | undefined) {
  return syntax?.reader === 'web-component' ? syntax : undefined;
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('backend shared WC syntax reader', () => {
  it('preserves last literal fields and marks conditional getter metadata unknown through the shared runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-wc-metadata-'));
    directories.push(directory);
    const path = join(directory, 'Example.ts');
    writeFileSync(
      path,
      `class Example extends HTMLElement {
        static get properties() {
          if (dynamicCondition) return { label: { attribute: 'alternate', reflect: true } };
          return { label: { type: String } };
        }
        static get observedAttributes() {
          if (dynamicCondition) return ['alternate'];
          return ['label'];
        }
        label: string = '';
      } customElements.define('example-component', Example);
      class LiteralExample extends HTMLElement {
        @property({ attribute: 'first', attribute: 'last', reflect: true, reflect: false, type: Number, type: String }) label = '';
      } customElements.define('literal-component', LiteralExample);`,
    );
    const result = await extractWebComponentDefinitions([path]);
    const candidate = (name: string) =>
      result.components
        .find((component) => component.name === name)
        ?.sourceCandidates?.find((item) => item.name === 'label');
    expect(candidate('Example')?.observations[0]?.syntax).toMatchObject({
      converter: { state: 'unknown' },
      attribute: { state: 'unknown', name: null },
      reflect: { state: 'unknown', value: null },
    });
    expect(
      webSyntax(candidate('Example')?.observations.find((item) => item.evidenceKind === 'runtime-object')?.syntax)
        ?.attribute.state,
    ).toBe('unknown');
    expect(candidate('LiteralExample')?.observations[0]?.syntax).toMatchObject({
      converter: { state: 'known', expression: 'String' },
      attribute: { state: 'explicit', name: 'last' },
      reflect: { state: 'explicit', value: false },
    });
    expect(result.extractionDiagnostics?.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'wc-unknown-static-properties' }),
        expect.objectContaining({ reason: 'wc-unknown-observed-attributes' }),
      ]),
    );
  });

  it('delivers the same declarations, metadata, values, inherited slots and receipts ', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-wc-source-'));
    directories.push(directory);
    writeFileSync(
      join(directory, 'base.ts'),
      `export enum Mode { First = 0, Second = 2 } export const INITIAL = Mode.Second;
      /** @slot base - Base content */ export class Base extends HTMLElement { title: string = 'base'; }
      export const WithLabel = (Supplied: typeof Base) => class extends Supplied { label: string = 'label'; };`,
    );
    const path = join(directory, 'Example.ts');
    writeFileSync(
      path,
      `import { Base, WithLabel, Mode, INITIAL } from './base.js';
      class Example extends WithLabel(Base) {
        @property({ type: String, attribute: 'data-mode', reflect: false }) mode: Mode = INITIAL;
        @state() _private = 0;
        @property({ attribute: false }) '$value' = '';
        title: 'own' = 'own';
        render() { return html\`<slot name="body"></slot>\`; }
      } customElements.define('example-component', Example);`,
    );
    const result = await extractWebComponentDefinitions([path], undefined, { projectRoot: directory });
    expect(
      result.components[0]?.sourceCandidates?.find((candidate) => candidate.name === 'mode')?.facts?.domain
        .observedLiterals,
    ).toEqual([
      { kind: 'number', value: '0' },
      { kind: 'number', value: '2' },
    ]);
    expect(result.components[0]?.sourceCandidates?.map((candidate) => candidate.name)).toEqual(
      expect.arrayContaining(['_private', '$value', 'base', 'body', 'label', 'title']),
    );
    expect(result.extractionDiagnostics?.projects[0]?.options.noEmit).toBe(true);
  });

  it('reads a registered JavaScript class expression and reports an unresolved base honestly', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-wc-js-'));
    directories.push(directory);
    const path = join(directory, 'Example.js');
    writeFileSync(
      path,
      `const Example = class extends unknownFactory(Base) { static properties = { value: { type: Number } }; value = 0; }; customElements.define('example-component', Example);`,
    );
    const result = await extractWebComponentDefinitions([path]);
    expect(result.components[0]?.sourceCandidates?.find((candidate) => candidate.name === 'value')?.type).toBe(
      'number',
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: 'wc-unresolved-mixin' }),
    );
  });
});
