import { describe, it, expect, afterEach } from 'vitest';
import { createMockCMAServer, type MockCMAServer } from './mock-cma-server.js';

describe('mock CMA server', () => {
  let server: MockCMAServer;

  afterEach(() => {
    server?.close();
  });

  it('starts on a random port and responds to requests', async () => {
    server = await createMockCMAServer();
    const res = await fetch(`${server.url}/users/me`);
    expect(res.status).toBe(200);
  });

  it('returns configured responses for specific routes', async () => {
    server = await createMockCMAServer({
      'GET /spaces/s1': { sys: { type: 'Space', id: 's1' } },
    });
    const res = await fetch(`${server.url}/spaces/s1`);
    const body = await res.json();
    expect(body.sys.id).toBe('s1');
  });

  it('returns 404 for unconfigured routes', async () => {
    server = await createMockCMAServer({});
    const res = await fetch(`${server.url}/unknown`);
    expect(res.status).toBe(404);
  });

  it('records requests for assertion', async () => {
    server = await createMockCMAServer();
    await fetch(`${server.url}/spaces/test-space`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].method).toBe('POST');
    expect(server.requests[0].body).toEqual({ hello: 'world' });
  });
});
