import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCliWithEnv } from '../helpers/cli-runner.js';

const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');

const validationBody = {
  sys: { type: 'Error', id: 'ValidationFailed' },
  message: 'Validation error',
  details: { errors: [{ name: 'invalid_union', path: [], details: 'Invalid input' }] },
};

describe('apply push — actionable preview diagnostics', () => {
  let server: Server;
  let host: string;

  beforeAll(async () => {
    await new Promise<void>((resolveServer) => {
      server = createServer((req, res) => {
        if (req.method === 'POST' && req.url?.endsWith('/design_systems/imports/preview')) {
          res.writeHead(422, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(validationBody));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sys: { type: 'User', id: 'user-1' } }));
      });
      server.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
        host = `http://127.0.0.1:${address.port}`;
        resolveServer();
      });
    });
  });

  afterAll(() => server.close());

  it('keeps the preview phase while rendering an empty-path validation error safely', async () => {
    const { code, stderr } = await runCliWithEnv(
      [
        'apply',
        'push',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--yes',
        '--host',
        host,
      ],
      {
        NODE_NO_WARNINGS: '1',
        CONTENTFUL_SPACE_ID: '',
        CONTENTFUL_ENVIRONMENT_ID: '',
        CONTENTFUL_MANAGEMENT_TOKEN: '',
      },
    );

    expect(code).not.toBe(0);
    expect(stderr).toContain('preview failed: 422');
    expect(stderr).toContain('[ValidationFailed]');
    expect(stderr).toContain('Invalid input');
    expect(stderr).toContain('Location: not provided by the server');
    expect(stderr).not.toContain('Component:');
  });
});
