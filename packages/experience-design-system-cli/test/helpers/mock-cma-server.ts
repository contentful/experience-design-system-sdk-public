import { createServer, type Server } from 'node:http';

export type MockCMAServer = {
  url: string;
  port: number;
  close: () => void;
  requests: Array<{ method: string; url: string; body?: unknown }>;
};

const DEFAULT_RESPONSES: Record<string, unknown> = {
  'GET /users/me': {
    sys: { type: 'User', id: 'user-1' },
  },
};

export function createMockCMAServer(responses: Record<string, unknown> = {}): Promise<MockCMAServer> {
  const merged = { ...DEFAULT_RESPONSES, ...responses };
  const requests: MockCMAServer['requests'] = [];

  return new Promise((resolve) => {
    const server: Server = createServer(async (req, res) => {
      const method = req.method ?? 'GET';
      const url = req.url ?? '/';
      let body: unknown;

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          body = undefined;
        }
      }

      requests.push({ method, url, body });

      const key = `${method} ${url}`;
      const responseBody = merged[key];

      if (responseBody !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No mock for ${key}` }));
      }
    });

    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () => server.close(),
        requests,
      });
    });
  });
}
