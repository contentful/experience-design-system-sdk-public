import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type SourceSyntaxObservation,
  bindSourceCandidatesToCapture,
  extractWebComponentDefinitions as extractPublic,
} from '../../../src/steps/extraction/index.js';
import { extractWebComponentDefinitions } from '../../../src/steps/extraction/src/framework-adapters/web-components/extract-web-components.js';

import { isSourceCandidatePayload } from '../../../src/persistence/src/session/repositories/source-evidence-validation.js';

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
    const direct = await extractPublic([path]);
    expect(result.components.map((component) => component.sourceCandidates)).toEqual(
      direct.components.map((component) => component.sourceCandidates),
    );
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
    expect(result.components.every((component) => isSourceCandidatePayload(component.sourceCandidates))).toBe(true);
  });

  it('delivers the same declarations, metadata, values, inherited slots and receipts as the public producer', async () => {
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
    const direct = await extractPublic([path], undefined, { projectRoot: directory });
    expect(result.components[0]?.sourceCandidates).toEqual(direct.components[0]?.sourceCandidates);
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
    expect(result.components[0]?.slots).toEqual(direct.components[0]?.slots);
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
  it('validates saved syntax and binds each default/type receipt without inventing byte equality', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'backend-wc-binding-'));
    directories.push(directory);
    const path = join(directory, 'Example.ts');
    const base = join(directory, 'values.ts');
    const values = 'export enum Mode { First = 0, Second = 2 } export const INITIAL = Mode.Second;';
    const source = `import { Mode, INITIAL } from './values.js'; class Example extends HTMLElement { mode: Mode = INITIAL; } customElements.define('example-component', Example);`;
    writeFileSync(base, values);
    writeFileSync(path, source);
    const result = await extractWebComponentDefinitions([path]);
    const hashes = [
      { canonicalPath: path, textHash: createHash('sha256').update(source).digest('hex') },
      { canonicalPath: base, textHash: createHash('sha256').update(values).digest('hex') },
    ];
    const bind = (captured: typeof hashes) =>
      bindSourceCandidatesToCapture(result.components, captured)[0]!.sourceCandidates!.find(
        (item) => item.name === 'mode',
      )!;
    const verified = bind(hashes);
    expect(isSourceCandidatePayload([verified])).toBe(true);
    expect(
      verified.observations[0]?.syntax?.default.locations.every((location) => location.binding === 'verified'),
    ).toBe(true);
    expect(verified.observations[0]?.syntax?.typeLocations.every((location) => location.binding === 'verified')).toBe(
      true,
    );
    const changed = bind([{ ...hashes[0]! }, { canonicalPath: base, textHash: 'changed' }]);
    expect(
      changed.observations[0]?.syntax?.default.locations
        .filter((location) => location.canonicalPath === base)
        .every((location) => location.binding === 'changed'),
    ).toBe(true);
    expect(
      bind([hashes[0]!]).observations[0]?.syntax?.default.locations.some(
        (location) => location.binding === 'unavailable',
      ),
    ).toBe(true);
    expect(
      isSourceCandidatePayload([
        {
          ...verified,
          observations: [
            {
              ...verified.observations[0],
              syntax: { ...verified.observations[0]?.syntax, reflect: { state: 'explicit', value: 'invalid' } },
            },
          ],
        },
      ]),
    ).toBe(false);
  });
});
