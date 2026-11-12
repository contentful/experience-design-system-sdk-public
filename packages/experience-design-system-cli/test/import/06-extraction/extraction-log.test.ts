import { describe, expect, it } from 'vitest';
import { extractionLog } from '../../../src/tui/import/steps/06-extraction/log.js';
import type { ExtractionInput } from '../../../src/tui/import/steps/06-extraction/types.js';

describe('the Extraction debug log', () => {
  // Extraction is given the credentials, and its failures come from the agent and the API, which can echo what they were
  // sent. What must hold is that the log does not carry the CMA token at all (the Credentials log has the credentials),
  // and that a failure message is scrubbed of it.
  it('leaves the CMA token out, and out of a failure message that echoes it', () => {
    const token = 'CFPAT-s3cr3t/abc+def=';
    const input: ExtractionInput = {
      projectPath: '/proj',
      filePaths: ['/proj/a.tsx', '/proj/b.tsx'],
      rawTokensPath: '/proj/tokens.json',
      credentials: { spaceId: 'space1', environmentId: 'master', cmaToken: token, host: 'api.contentful.com' },
      agent: 'claude',
      promptOverrides: [],
      noCache: false,
    };

    const { summary, data, status } = extractionLog({
      input,
      result: {
        ok: false,
        step: 'selection agent',
        message: `401 Unauthorized for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`,
      },
      rows: [],
      components: [],
    });

    const written = JSON.stringify({ summary, data });
    expect(written).not.toContain(token);
    expect(written).not.toContain(encodeURIComponent(token));
    expect(data).not.toHaveProperty('cma_token');
    // The failure is still explained: which step, and what it said.
    expect(status).toBe('error');
    expect(data).toMatchObject({
      failed_step: 'selection agent',
      error: expect.stringContaining('401 Unauthorized for [redacted]'),
    });
    expect(summary.join('\n')).toContain('Result: failed at selection agent: 401 Unauthorized for [redacted]');
  });
});
