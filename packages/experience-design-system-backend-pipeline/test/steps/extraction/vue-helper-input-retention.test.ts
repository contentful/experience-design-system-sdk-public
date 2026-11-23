import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractVueTsxComponents } from '../../../src/steps/extraction/src/framework-adapters/vue-tsx/extractor.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it.each(['pick', 'omit', 'reshape'])(
  'reads the actual returned props instead of assigning behavior to a helper named %s',
  async (name) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-helper-contract-')));
    roots.push(root);
    const path = join(root, 'Example.tsx');
    writeFileSync(
      path,
      `import { defineComponent } from 'vue';
      function ${name}() {
        return { actual: { type: Boolean, default: true } };
      }
      export const Example = defineComponent({
        props: ${name}(),
        setup(props) { return () => <div>{props.actual}</div>; },
      });`,
    );
    const component = (await extractVueTsxComponents([path])).components[0]!;
    expect(component.props.map((prop) => prop.name)).toEqual(['actual']);
    expect(component.props[0]).toMatchObject({ type: 'boolean', defaultValue: 'true' });
    expect(
      component.sourceCandidates
        ?.filter((candidate) => candidate.projection.kind === 'prop')
        .map((candidate) => candidate.name),
    ).toEqual(['actual']);
  },
);

it.each(['propsFactory', 'createInputs'])(
  'does not assume an unavailable factory named %s returns its first argument',
  async (name) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-factory-contract-')));
    roots.push(root);
    const path = join(root, 'Example.tsx');
    writeFileSync(
      path,
      `import { defineComponent } from 'vue';
      import { ${name} } from './unavailable.js';
      const make = ${name}({ label: String });
      export const Example = defineComponent({ props: make() });`,
    );
    const result = await extractVueTsxComponents([path]);
    expect(result.components[0]?.props).toEqual([]);
    expect(result.components[0]?.sourceCandidates).toContainEqual(
      expect.objectContaining({ facts: expect.objectContaining({ certainty: 'unknown' }) }),
    );
  },
);

it.each(['pick', 'omit', 'reshape'])(
  'retains unresolved helper %s as uncertainty without inventing returned keys',
  async (name) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'vue-helper-unresolved-')));
    roots.push(root);
    const path = join(root, 'Example.tsx');
    writeFileSync(
      path,
      `import { defineComponent } from 'vue';
      import { ${name} } from './unavailable.js';
      const input = { label: String, size: Number };
      export const Example = defineComponent({ props: ${name}(input, ['label']) });`,
    );
    const result = await extractVueTsxComponents([path]);
    expect(result.components[0]?.props).toEqual([]);
    expect(result.components[0]?.sourceCandidates).toContainEqual(
      expect.objectContaining({ facts: expect.objectContaining({ certainty: 'unknown' }) }),
    );
    expect(result.extractionDiagnostics?.modules).toContainEqual(
      expect.objectContaining({ reason: expect.stringContaining('vue-props-') }),
    );
  },
);
