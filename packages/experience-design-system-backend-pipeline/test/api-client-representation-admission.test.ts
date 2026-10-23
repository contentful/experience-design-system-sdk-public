import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCDF, validateCDF, type CDFSlotDefinition } from '@contentful/experience-design-system-types';
import { ApiClient } from '../src/steps/apply/src/helpers/api-client/api-client.js';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          sys: { id: 'example-operation', status: 'pending' },
          components: { created: [], updated: [], removed: [], unchanged: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
});
afterEach(() => {
  mockFetch.mockReset();
  vi.unstubAllGlobals();
});

const supportedCardinalities: Array<NonNullable<CDFSlotDefinition['$cardinality']>> = [
  { min: 0, max: null, ordered: true },
  { min: 1, max: 1, ordered: false },
  { min: 2, max: 2, ordered: true },
];
const unsupportedCardinalities: Array<NonNullable<CDFSlotDefinition['$cardinality']>> = [
  { min: 0, max: 0, ordered: true },
  { min: 0, max: 1, ordered: true, tuplePosition: 1 },
  { min: 0, max: null, ordered: true, rest: true },
];

describe.each(['preview', 'apply'] as const)('%s representation admission', (phase) => {
  const send = (cdf: NonNullable<ReturnType<typeof buildCDF>>) => {
    const client = new ApiClient({ cmaToken: 'example-token', spaceId: 'example-space', environmentId: 'example-env' });
    return phase === 'preview'
      ? client.previewImport(cdf)
      : client.applyImport(cdf, { acknowledgeBreakingChanges: false });
  };

  it.each(supportedCardinalities)('sends supported cardinality %j without changing the source', async (cardinality) => {
    const cdf = buildCDF(
      [
        {
          key: 'Example',
          entry: { $type: 'component', $properties: {}, $slots: { items: { $cardinality: cardinality } } },
        },
      ],
      [],
    )!;
    await send(cdf);
    expect(mockFetch).toHaveBeenCalledOnce();
    const request = mockFetch.mock.calls[0]![0] as Request;
    expect(await request.json()).toEqual(phase === 'preview' ? cdf : { ...cdf, acknowledgeBreakingChanges: false });
  });

  it.each(unsupportedCardinalities)('holds unsupported cardinality %j before HTTP', async (cardinality) => {
    const cdf = buildCDF(
      [
        {
          key: 'Example',
          entry: { $type: 'component', $properties: {}, $slots: { items: { $cardinality: cardinality } } },
        },
      ],
      [],
    )!;
    expect(validateCDF(cdf).valid).toBe(true);
    await expect(send(cdf)).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps ordinary native properties and slots admissible', async () => {
    const cdf = buildCDF(
      [
        {
          key: 'Example',
          entry: {
            $type: 'component',
            $properties: { label: { $type: 'string', $category: 'content', $default: 'example' } },
            $slots: { children: { $required: false } },
          },
        },
      ],
      [],
    )!;
    expect(validateCDF(cdf).valid).toBe(true);
    await send(cdf);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('sends typed scalar choices, richer content and manual numeric design definitions intact', async () => {
    const properties = {
      label: { $type: 'string', $category: 'content', $values: ['a', 'b'], $default: 'a' },
      count: { $type: 'number', $category: 'content', $values: [1, 2], $default: 1 },
      integer: { $type: 'Integer', $category: 'content', $default: 1 },
      enabled: { $type: 'boolean', $category: 'design', $values: [false], $default: false },
      size: { $type: 'number', $category: 'design', $values: [0, 10], $default: 0 },
      document: { $type: 'RichText', $category: 'content' },
      data: { $type: 'JSON', $category: 'content' },
    } as const;
    const cdf = buildCDF([{ key: 'Example', entry: { $type: 'component', $properties: properties as never } }], [])!;
    await send(cdf);
    expect(mockFetch).toHaveBeenCalledOnce();
    const request = mockFetch.mock.calls[0]![0] as Request;
    expect(await request.json()).toEqual(phase === 'preview' ? cdf : { ...cdf, acknowledgeBreakingChanges: false });
  });
});
