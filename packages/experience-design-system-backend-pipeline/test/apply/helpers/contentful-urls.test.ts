import { describe, expect, it } from 'vitest';
import { buildPostPushUrl } from '../../../src/apply/helpers/contentful-urls.js';

describe('buildPostPushUrl', () => {
  it('builds a URL with api host converted to app host', () => {
    expect(buildPostPushUrl({ host: 'api.contentful.com', spaceId: 'sp1', environmentId: 'master' })).toBe(
      'https://app.contentful.com/spaces/sp1/environments/master/views/components',
    );
  });

  it('strips https:// prefix before converting api. to app.', () => {
    expect(buildPostPushUrl({ host: 'https://api.contentful.com', spaceId: 'sp1', environmentId: 'master' })).toBe(
      'https://app.contentful.com/spaces/sp1/environments/master/views/components',
    );
  });

  it('defaults view to components', () => {
    const url = buildPostPushUrl({ host: 'api.contentful.com', spaceId: 'sp1', environmentId: 'env1' });
    expect(url).toContain('/views/components');
  });

  it('uses the provided view when specified', () => {
    const url = buildPostPushUrl({ host: 'api.contentful.com', spaceId: 'sp1', environmentId: 'env1', view: 'design_tokens' });
    expect(url).toContain('/views/design_tokens');
  });

  it('strips trailing slashes from host', () => {
    const url = buildPostPushUrl({ host: 'api.contentful.com/', spaceId: 'sp1', environmentId: 'env1' });
    expect(url).toBe('https://app.contentful.com/spaces/sp1/environments/env1/views/components');
  });
});
