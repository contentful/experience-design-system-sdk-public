/**
 * Tiny in-process HTTP mock of the Contentful Experiences Management API
 * (EMA) endpoints the CLI hits during `apply push`.
 *
 * Why in-process instead of nock: the CLI runs in a spawned child
 * process, so any in-process interceptor in the test wouldn't affect
 * the child's `fetch()` calls. A localhost HTTP server does — point the
 * CLI's --host at us and record every request.
 *
 * Endpoints stubbed:
 *   POST /spaces/:sid/environments/:eid/design_systems/imports/preview
 *   POST /spaces/:sid/environments/:eid/design_systems/imports/apply
 *   GET  /spaces/:sid/environments/:eid/design_systems/imports/apply/:opid
 *
 * The default responses report "no changes"; individual tests override
 * with `server.stub(method, urlPattern, handler)`.
 */
import { createServer } from 'node:http';

export async function startMockEma() {
  const requests = [];
  const stubs = [];

  function match(req) {
    const url = new URL(req.url, 'http://127.0.0.1');
    for (const s of stubs) {
      if (s.method !== req.method) continue;
      if (s.pattern instanceof RegExp) {
        if (!s.pattern.test(url.pathname)) continue;
      } else if (s.pattern !== url.pathname) continue;
      return s;
    }
    return null;
  }

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({
        method: req.method,
        path: url.pathname,
        headers: req.headers,
        body,
      });

      const stub = match(req);
      if (stub) {
        stub.handler(req, res, body);
        return;
      }

      // Sensible defaults for the endpoints the CLI hits.
      if (url.pathname === '/users/me' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ sys: { id: 'mock-user' }, email: 'mock@example.com' }));
        return;
      }
      if (url.pathname.endsWith('/imports/preview') && req.method === 'POST') {
        // Shape must match ServerPreviewResponse from
        // packages/experience-design-system-types — components/tokens/taxonomies
        // each have new[]/changed[]/unchanged[]/removed[].
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            components: { new: [], changed: [], unchanged: [], removed: [] },
            tokens: { new: [], changed: [], unchanged: [], removed: [] },
            taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
          }),
        );
        return;
      }
      // Apply response must match ApplyOperationResponse from
      // packages/experience-design-system-types.
      const applyOperation = (status) => ({
        sys: {
          type: 'ApplyOperation',
          id: 'op-mock-001',
          status,
          createdAt: '2026-07-06T00:00:00Z',
          createdBy: { sys: { type: 'Link', linkType: 'User', id: 'mock-user' } },
        },
        summary: { total: 1, pending: 0, succeeded: 1, failed: 0 },
        items: [],
      });
      if (url.pathname.endsWith('/imports/apply') && req.method === 'POST') {
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify(applyOperation('succeeded')));
        return;
      }
      if (/\/imports\/apply\/[^/]+$/.test(url.pathname) && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(applyOperation('succeeded')));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const host = `http://127.0.0.1:${address.port}`;

  return {
    host,
    requests,
    stub(method, pattern, handler) {
      stubs.push({ method, pattern, handler });
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
