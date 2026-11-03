import { describe, expect, it } from 'vitest';
import { extractionLogInputs, extractionLogOutputs } from '../../../src/tui/import/steps/06-extraction/logic.js';
import type { ExtractionInput } from '../../../src/tui/import/steps/06-extraction/types.js';

describe('the Extraction debug log', () => {
  // Extraction is given the credentials, and its failures come from the agent and the API, which can echo what they were
  // sent. What must hold is that the CMA token is only ever under `cma_token`, the key the logger reduces to its length
  // (that reduction is covered by the Credentials log test), and that a failure message is scrubbed of it.
  it('keeps the CMA token to its own key and out of a failure message that echoes it', () => {
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

    const { cma_token: tokenKey, ...rest } = extractionLogInputs(input);
    const { outputs, status } = extractionLogOutputs(
      {
        ok: false,
        step: 'selection agent',
        message: `401 Unauthorized for ${token} (url: /spaces?access_token=${encodeURIComponent(token)})`,
      },
      undefined,
      token,
    );

    expect(tokenKey).toBe(token);
    expect(JSON.stringify(rest)).not.toContain(token);
    expect(JSON.stringify(outputs)).not.toContain(token);
    expect(JSON.stringify(outputs)).not.toContain(encodeURIComponent(token));
    // The failure is still explained: which step, and what it said.
    expect(status).toBe('error');
    expect(outputs).toMatchObject({
      failed_step: 'selection agent',
      error: expect.stringContaining('401 Unauthorized'),
    });
  });
});
