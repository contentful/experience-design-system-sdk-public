import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { extractReactComponents } from '../../../src/steps/extraction/src/framework-adapters/react/extract-react-components.js';

it('uses the shared field-local seam in normal and parameterless backend React producers', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backend-component-facts-'));
  try {
    const path = join(directory, 'Panel.tsx');
    writeFileSync(
      path,
      `type Props = { label: 'short' | 'long' }; export function Panel({ label = 'short' }: Props) { return <div>{label}</div>; } export function Empty() { return <div/>; }`,
    );
    const baseline = await extractReactComponents([path]);
    const names: string[] = [];
    const supplied = await extractReactComponents([path], undefined, {
      componentFactCollectors: {
        members: (context) => {
          names.push(context.name);
          return [{ name: 'Item', certainty: 'unknown', location: context.declaration }];
        },
      },
    });
    expect(names.sort()).toEqual(['Empty', 'Panel']);
    for (const component of supplied.components) {
      const { componentFacts, ...ordinary } = component;
      expect(ordinary).toEqual(baseline.components.find((candidate) => candidate.name === component.name));
      expect(componentFacts?.members?.[0]).toMatchObject({
        name: 'Item',
        location: { canonicalPath: path, textHash: expect.any(String) },
      });
    }
    expect(supplied.components.find((component) => component.name === 'Panel')?.sourceCandidates?.[0]).toMatchObject({
      declaredRequired: true,
      sourceDefault: "'short'",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
