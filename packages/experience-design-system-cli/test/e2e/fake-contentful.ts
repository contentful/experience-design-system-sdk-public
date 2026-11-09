import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// A local server standing in for the Contentful API. It answers the calls the import makes, always successfully, and
// keeps what it was sent so a scenario can look at it. The user types its address as the API host.

export interface FakeContentful {
  /** What the user types as the API host. */
  host: string;
  /** Every request, as "METHOD /path", in order. */
  requests: string[];
  /** The documents sent to preview. */
  previewed: Array<Record<string, unknown>>;
  /** The documents sent to apply. */
  pushed: Array<Record<string, unknown>>;
  stop(): Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
};

const emptyGroup = { new: [], changed: [], unchanged: [], removed: [] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The tokens in a CDF document: every object with a `$type` and a `$value`, named by its dotted path. */
function tokensIn(
  node: unknown,
  path: string[] = [],
): Array<{ id: string; name: string; type: string; entry: Record<string, unknown> }> {
  if (!isRecord(node)) return [];
  if (path.length > 0 && '$type' in node && '$value' in node) {
    const id = path.join('.');
    return [{ id, name: id, type: String(node['$type']), entry: node }];
  }
  return Object.entries(node).flatMap(([key, child]) => (key.startsWith('$') ? [] : tokensIn(child, [...path, key])));
}

export async function startFakeContentful(): Promise<FakeContentful> {
  const requests: string[] = [];
  const previewed: Array<Record<string, unknown>> = [];
  const pushed: Array<Record<string, unknown>> = [];
  let lastPushed: Record<string, unknown> = {};

  // Everything pushed succeeds, so the operation is finished the moment it is asked about.
  const operation = (document: Record<string, unknown>) => {
    const items = tokensIn(document).map((token) => ({
      entityType: 'DesignToken',
      id: token.id,
      action: 'create',
      status: 'succeeded',
    }));
    return {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'succeeded',
        createdAt: new Date().toISOString(),
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: items.length, pending: 0, succeeded: items.length, failed: 0 },
      items,
    };
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push(`${request.method} ${path}`);
    const send = (status: number, value: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };

    if (path === '/users/me') return send(200, { sys: { type: 'User', id: 'user-1' } });
    if (path.endsWith('/design_systems/preflight')) return send(200, {});
    if (path.endsWith('/imports/preview')) {
      const document = await readBody(request);
      previewed.push(document);
      const created = tokensIn(document).map((token) => ({
        ...token.entry,
        id: token.id,
        name: token.name,
        type: token.type,
      }));
      return send(200, { components: emptyGroup, tokens: { ...emptyGroup, new: created }, taxonomies: emptyGroup });
    }
    if (path.endsWith('/imports/apply') && request.method === 'POST') {
      const document = await readBody(request);
      pushed.push(document);
      lastPushed = document;
      return send(202, operation(document));
    }
    if (path.includes('/imports/apply/')) return send(200, operation(lastPushed));
    send(404, {
      sys: { type: 'Error', id: 'NotFound' },
      message: `fake contentful: no answer for ${request.method} ${path}`,
    });
  };

  const server = createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    previewed,
    pushed,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
