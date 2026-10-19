import { describe, expect, it } from 'vitest';
import { scrubError } from '../../../src/tui/settings/shared/debug-trail.js';

// A debug log is a file users send us, so the one thing that must hold is that no credential reaches it.
describe('what a settings debug log is allowed to say', () => {
  it('keeps the CMA token out of an error message, as typed and as it appears URL-encoded in a request error', () => {
    const token = 'CFPAT-abc/def+ghi=';
    const error = new Error(`401 for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`);

    const message = scrubError(error, [token]);

    expect(message).not.toContain(token);
    expect(message).not.toContain(encodeURIComponent(token));
    expect(message).toContain('[redacted]');
  });
});
