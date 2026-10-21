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

const cardinalities: Array<NonNullable<CDFSlotDefinition['$cardinality']>> = [
  { min: 0, max: null, ordered: true },
  { min: 1, max: 1, ordered: false },
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

  it.each(cardinalities)('holds standalone cardinality %j before HTTP', async (cardinality) => {
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
    await expect(send(cdf)).rejects.toThrow('prerequisites are unavailable');
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
});
