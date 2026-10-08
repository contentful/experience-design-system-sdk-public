import { describe, expect, it } from 'vitest';
import { buildUserAgent } from '../helpers/metadata/build-user-agent.js';

describe('buildUserAgent', () => {
  it('includes app + platform + os segments in CEP-0056 shape', () => {
    const ua = buildUserAgent('1.2.3');
    expect(ua).toContain('app contentful.experience-design-system-cli/1.2.3');
    expect(ua).toContain('platform node.js/');
    expect(ua.endsWith(';')).toBe(true);
  });
});
