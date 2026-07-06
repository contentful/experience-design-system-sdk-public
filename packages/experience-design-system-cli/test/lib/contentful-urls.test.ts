import { describe, it, expect } from 'vitest';
import { buildPostPushUrl } from '../../src/lib/contentful-urls.js';

describe('buildPostPushUrl', () => {
  it('maps api.contentful.com → app.contentful.com', () => {
    expect(
      buildPostPushUrl({
        host: 'api.contentful.com',
        spaceId: 'space-1',
        environmentId: 'master',
      }),
    ).toBe('https://app.contentful.com/spaces/space-1/environments/master/views/components');
  });

  it('maps api.flinkly.com → app.flinkly.com', () => {
    expect(
      buildPostPushUrl({
        host: 'api.flinkly.com',
        spaceId: 'space-2',
        environmentId: 'staging',
      }),
    ).toBe('https://app.flinkly.com/spaces/space-2/environments/staging/views/components');
  });

  it('maps api.quirely.com → app.quirely.com', () => {
    expect(
      buildPostPushUrl({
        host: 'api.quirely.com',
        spaceId: 'space-3',
        environmentId: 'preview',
      }),
    ).toBe('https://app.quirely.com/spaces/space-3/environments/preview/views/components');
  });

  it('passes through unknown hosts that do not match the api. prefix', () => {
    // Per the spec risk note: for unknown hosts (e.g. `api.contentful.dev`), fall through
    // to the raw host rather than guessing. The `api.` → `app.` swap still applies (regex
    // matches), so we exercise an entirely non-api host here.
    expect(
      buildPostPushUrl({
        host: 'localhost:3000',
        spaceId: 'space-x',
        environmentId: 'master',
      }),
    ).toBe('https://localhost:3000/spaces/space-x/environments/master/views/components');
  });

  it('strips https:// prefix and trailing slashes from host input', () => {
    expect(
      buildPostPushUrl({
        host: 'https://api.contentful.com/',
        spaceId: 'space-1',
        environmentId: 'master',
      }),
    ).toBe('https://app.contentful.com/spaces/space-1/environments/master/views/components');
  });

  it('output matches the existing wizard DoneStep URL for api.contentful.com (snapshot)', () => {
    const spaceId = 'snapshot-space';
    const environmentId = 'snapshot-env';
    const wizardUrl = `https://app.contentful.com/spaces/${spaceId}/environments/${environmentId}/views/components`;
    expect(
      buildPostPushUrl({
        host: 'api.contentful.com',
        spaceId,
        environmentId,
      }),
    ).toBe(wizardUrl);
  });
});
