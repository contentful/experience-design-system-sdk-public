import { afterEach, expect, expectTypeOf, it, vi } from 'vitest';
import {
  designSystemImportCreate,
  designSystemImportSourcelessPreview,
  type CDFComponentEntry,
  type BreakingChange,
  type ServerPreviewResponse,
} from '../src/index.js';
import type {
  CdfComponent,
  BreakingChange as GeneratedBreakingChange,
  ComponentTypeSummary as GeneratedSummary,
} from '../src/generated/types.gen.js';
import { buildCDF, CDF_SCHEMA_URL } from '@contentful/experience-design-system-types';
import specification from '../openapi.json' with { type: 'json' };
afterEach(() => vi.unstubAllGlobals());
it('connects generated sourceful/sourceless transport and shared recursive public types', async () => {
  expectTypeOf<GeneratedBreakingChange>().toMatchTypeOf<BreakingChange>();
  const cardinalityChange = {
    slotId: 'items',
    reason: 'slot_cardinality_narrowed',
  } satisfies GeneratedBreakingChange;
  type SummaryIdentity = 'id' | 'name' | 'contentProperties' | 'designProperties' | 'slots';
  expectTypeOf<Pick<ServerPreviewResponse['components']['removed'][number], SummaryIdentity>>().toExtend<
    Pick<GeneratedSummary, SummaryIdentity>
  >();
  const entry = {
    $type: 'component',
    $properties: {
      ['__proto__']: {
        $type: 'record',
        $category: 'content',
        $required: false,
        $fields: { 'a/b~c': { $type: 'boolean', $required: true } },
        $default: { 'a/b~c': false },
      },
    },
    $slots: { constructor: { $required: false }, required: { $required: true } },
  } satisfies CDFComponentEntry;
  const wireComponent: CdfComponent = entry;
  expect(wireComponent).toEqual(entry);
  const response = {
    components: {
      new: [],
      changed: [
        {
          current: {
            id: 'example',
            name: 'Example',
            contentProperties: [],
            designProperties: [],
            slots: ['required'],
            sourceDefinition: entry,
            targetDefinition: {
              name: 'Example',
              metadata: { arbitrary: { ['__proto__']: 'retained', sys: { custom: true } } },
            },
            fullProperties: {
              opaque: {
                type: 'Future',
                category: 'content',
                required: false,
                default: null,
                targetDefinition: { type: 'Future', extensions: { $ref: 'opaque' } },
                diagnostics: [{ code: 'held' }],
              },
            },
            fullSlots: { required: { required: true, metadata: { custom: false } } },
          },
          proposed: entry,
          hasPendingDraftChanges: false,
          changeClassification: {
            classification: 'breaking',
            breakingChanges: [
              { slotId: 'required', reason: 'slot_became_required' },
              { slotId: 'new', reason: 'slot_added_required' },
              cardinalityChange,
            ],
          },
          projectionDiagnostics: [
            {
              componentId: 'example',
              propertyId: 'prop',
              path: '/',
              outcome: 'conditional',
              code: 'unknown-mapper',
              message: 'Unavailable',
            },
          ],
        },
      ],
      unchanged: [],
      removed: [],
    },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  };
  const requests: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const cdf = buildCDF([{ key: 'Example', entry }], [])!;
  const result = await designSystemImportSourcelessPreview({
    baseUrl: 'https://api.example.com',
    path: { spaceId: 'example', environmentId: 'example' },
    body: cdf as never,
  });
  expect(result.data).toEqual(response);
  expect(result.data?.components.changed[0]?.current.targetDefinition).toEqual(
    response.components.changed[0]!.current.targetDefinition,
  );
  expect(JSON.parse(await requests[0]!.text())).toEqual(cdf);
  const source = await designSystemImportCreate({
    baseUrl: 'https://api.example.com',
    path: { spaceId: 'example', environmentId: 'example' },
    body: { sourceId: 'example-source' },
  });
  expect(source.data).toEqual(response);
  expect(requests[1]!.url).toContain('/design_systems/preview');
  const schema = (specification.components.schemas as Record<string, any>).CDFComponent;
  expect(schema.properties.$properties.additionalProperties.$ref).toContain('CDFProperty');
  expect(
    (specification.components.schemas as Record<string, any>).BreakingChange.oneOf[1].properties.reason.enum,
  ).toContain('slot_added_required');
  expect(
    (specification.components.schemas as Record<string, any>).BreakingChange.oneOf[1].properties.reason.enum,
  ).toContain('slot_cardinality_narrowed');
  expect(CDF_SCHEMA_URL).toEqual(cdf.$schema);
  expect((specification.components.schemas as Record<string, any>).ComponentTypeSummary.properties).toHaveProperty(
    'targetDefinition',
  );
});
