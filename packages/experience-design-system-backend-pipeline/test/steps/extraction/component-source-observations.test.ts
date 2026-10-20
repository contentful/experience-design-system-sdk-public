import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { extractReactComponents as extractPublic } from '@contentful/experience-design-system-extraction';
import { extractReactComponents as extractBackend } from '../../../src/steps/extraction/src/framework-adapters/react/extract-react-components.js';

it('collects identical real default normal/parameterless source observations at both React producers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'producer-observations-'));
  try {
    const path = join(root, 'Panel.tsx');
    writeFileSync(
      path,
      `declare function read(value: string): string; type Props = { mode: 'short' | 'long'; label: string }; export function Panel({ mode='short', label }: Props) { return <div>{read(label)}{mode}</div>; } export function Empty() { return <div>{Math.max(1,2)}</div>; }`,
    );
    const publicResult = await extractPublic([path], undefined, { projectRoot: root });
    const backendResult = await extractBackend([path], undefined, { projectRoot: root });
    expect(publicResult.components.map((component) => component.componentFacts)).toEqual(
      backendResult.components.map((component) => component.componentFacts),
    );
    for (const component of publicResult.components)
      expect(
        component.componentFacts?.sourceObservations?.observations.some((observation) => observation.kind === 'call'),
      ).toBe(true);
    const panel = publicResult.components.find((component) => component.name === 'Panel')!;
    expect(panel.sourceCandidates?.find((candidate) => candidate.name === 'mode')).toMatchObject({
      declaredRequired: true,
      sourceDefault: "'short'",
    });
    expect(panel.props.find((prop) => prop.name === 'mode')).toMatchObject({ required: false, defaultValue: 'short' });
    const emptyDefaults = await extractPublic([path], undefined, {
      projectRoot: root,
      componentFactCollectors: { sourceObservations: () => undefined },
    });
    expect(publicResult.components.map(({ componentFacts: _facts, ...component }) => component)).toEqual(
      emptyDefaults.components.map(({ componentFacts: _facts, ...component }) => component),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('keeps unresolved and forcibly bounded default observations identical across real producers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'partial-observations-'));
  try {
    const path = join(root, 'Panel.tsx');
    writeFileSync(
      path,
      'type Props = { label: string }; export function Panel(props: Props) { missingValue(props.label); return <div/>; }',
    );
    for (const limits of [undefined, { maxReferences: 0 }]) {
      const options = { projectRoot: root, componentObservationLimits: limits };
      const publicResult = await extractPublic([path], undefined, options);
      const backendResult = await extractBackend([path], undefined, options);
      expect(publicResult.components[0]!.componentFacts).toEqual(backendResult.components[0]!.componentFacts);
      expect(publicResult.components[0]!.componentFacts!.sourceObservations!.coverage).toBe('partial');
      expect(publicResult.components[0]!.sourceCandidates).toEqual(backendResult.components[0]!.sourceCandidates);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
