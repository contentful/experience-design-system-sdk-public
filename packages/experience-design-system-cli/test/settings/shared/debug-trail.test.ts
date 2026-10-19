import { describe, expect, it } from 'vitest';
import { diffSnapshots, scrubError } from '../../../src/tui/settings/shared/debug-trail.js';

// A debug log is a file users send us, so the two things that must hold are that no credential reaches it and that the
// "did anything change" answer never repeats a value.
describe('what a settings debug log is allowed to say', () => {
  it('keeps the CMA token out of an error message, as typed and as it appears URL-encoded in a request error', () => {
    const token = 'CFPAT-abc/def+ghi=';
    const error = new Error(`401 for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`);

    const message = scrubError(error, [token]);

    expect(message).not.toContain(token);
    expect(message).not.toContain(encodeURIComponent(token));
    expect(message).toContain('[redacted]');
  });

  it('does not mangle a message by treating a very short value as a secret', () => {
    expect(scrubError(new Error('Space is not found'), ['is'])).toBe('Space is not found');
  });

  it('names the fields that changed and never their values, including a field that exists on only one side', () => {
    const change = diffSnapshots(
      { spaceId: 'abc', cmaToken: 'old-secret', host: 'api.contentful.com' },
      { spaceId: 'abc', cmaToken: 'new-secret', env: 'master' },
    );

    expect(change.changed).toBe(true);
    expect(change.changed_fields).toEqual(['cmaToken', 'host', 'env']);
    expect(JSON.stringify(change)).not.toContain('secret');
  });
});
