import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  attachComponentModelPlan,
  buildCDF,
  validateCDF,
  prepareAnalysisRepresentationCandidates,
  type CDFPropertyDefinition,
} from '@contentful/experience-design-system-types';
import { extractReactComponents } from '../src/steps/extraction/index.js';
import { validateGenerationPropertyDecision } from '../src/steps/generation/src/services/property/representation-feedback.js';
import { materializeProperty } from '../src/steps/generation/src/services/property/materialize-property.js';
import { sourcePropertyModel } from '../src/steps/generation/src/services/property/source-property-model.js';
import { buildRepresentationContext } from '../src/steps/generation/src/services/property/representation-context.js';

it.each(['value', '{ choice: value; label: string }'])(
  'repairs a physical union rejection through the generic model candidate: %s',
  async (shape) => {
    const directory = mkdtempSync(join(tmpdir(), 'generation-import-validity-'));
    try {
      const file = join(directory, 'Example.tsx');
      writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strictNullChecks: true, jsx: 'preserve' }, include: ['*.tsx'] }),
      );
      writeFileSync(
        file,
        `type value={kind:'text';label:string}|{kind:'count';count:number};type Props={settings:${shape}};export function Example({settings}:Props){return <div>{JSON.stringify(settings)}</div>}`,
      );
      const component = (await extractReactComponents([file], undefined, { projectRoot: directory })).components.find(
        (entry) => entry.name === 'Example',
      )!;
      const source = sourcePropertyModel(component, 'settings', component.name)!;
      const candidates = prepareAnalysisRepresentationCandidates(source);
      const context = buildRepresentationContext({
        component,
        componentId: component.name,
        inventory: { properties: ['settings'], slots: [] },
      }) as Array<{ nativeDefinitionImportIssues: unknown[] }>;
      expect(context[0]!.nativeDefinitionImportIssues.length).toBeGreaterThan(0);
      const sourceBefore = JSON.stringify(component.sourceCandidates);
      const selection = {
        tool: 'classify_prop' as const,
        prop: 'settings',
        cdf_category: 'content' as const,
        source_revision: source.identity.sourceRevision,
        source_node_id: source.identity.nodeId,
        representation_selection: {
          strategy: 'component-model' as const,
          candidateId: candidates.candidates.find((candidate) => candidate.strategy === 'component-model')!.id,
        },
      };
      const choice: CDFPropertyDefinition = {
        $type: 'DiscriminatedUnion',
        $category: 'content',
        discriminator: 'kind',
        members: [
          {
            $type: 'record',
            $fields: {
              kind: { $type: 'Literal', value: 'text', valueType: { $type: 'string' }, $required: true },
              label: { $type: 'string', $required: true },
            },
          },
          {
            $type: 'record',
            $fields: {
              kind: { $type: 'Literal', value: 'count', valueType: { $type: 'string' }, $required: true },
              count: { $type: 'number', $required: true },
            },
          },
        ],
      };
      const native: CDFPropertyDefinition =
        shape === 'value'
          ? choice
          : {
              $type: 'record',
              $category: 'content',
              $fields: { choice: { ...choice, $required: true }, label: { $type: 'string', $required: true } },
            };
      const rejected = validateGenerationPropertyDecision(component, {
        tool: 'classify_prop',
        prop: 'settings',
        cdf_category: 'content',
        cdf_type: native.$type,
        ...(native.$fields ? { fields: native.$fields } : {}),
        ...(native.discriminator ? { discriminator: native.discriminator, members: native.members } : {}),
        source_revision: source.identity.sourceRevision,
        source_node_id: source.identity.nodeId,
      });
      expect(rejected.state).toBe('pending');
      expect(
        rejected.feedback!.issues.some(({ message }) => message.includes('model representation')),
        JSON.stringify(rejected.feedback!.issues),
      ).toBe(true);
      expect(rejected.retainedCall.cdf_category).toBe('content');
      expect(validateGenerationPropertyDecision(component, selection).state).toBe('ready');
      const plan = materializeProperty(component, selection).selectedRepresentationPlan!;
      expect(plan.sdkValid, JSON.stringify(plan.issues)).toBe(true);
      expect(
        validateCDF(
          buildCDF(
            [{ key: 'Example', entry: attachComponentModelPlan({ $type: 'component', $properties: {} }, plan) }],
            [],
          ),
        ).valid,
      ).toBe(true);
      expect(plan.branchSelections!.length).toBeGreaterThan(0);
      expect(JSON.stringify(component.sourceCandidates)).toBe(sourceBefore);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
