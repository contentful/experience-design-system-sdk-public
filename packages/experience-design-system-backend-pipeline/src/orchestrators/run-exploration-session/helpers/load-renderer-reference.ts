import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { RendererReferenceInput, RendererReference } from '@contentful/experience-design-system-types';
import { throwIfAborted } from '../../../helpers/abort.js';
export const SDK_REFERENCE_URL = 'https://raw.githubusercontent.com/contentful/experiences/main/README.md';
export async function loadRendererReference(
  input: RendererReferenceInput = { kind: 'url' },
  options: { signal?: AbortSignal; fetchText?: typeof fetch } = {},
): Promise<RendererReference> {
  throwIfAborted(options.signal);
  let text: string, origin: string;
  if (input.kind === 'text') {
    text = input.text;
    origin = input.origin;
  } else if (input.kind === 'path') {
    origin = input.path;
    text = await readFile(input.path, { encoding: 'utf8', signal: options.signal });
  } else {
    origin = input.url ?? SDK_REFERENCE_URL;
    const response = await (options.fetchText ?? fetch)(origin, {
      signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new Error('Renderer reference fetch failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Renderer reference response body unavailable');
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  throwIfAborted(options.signal);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (!text.trim()) throw new Error('Renderer reference is empty');
  return {
    origin,
    text,
    digest: createHash('sha256').update(text).digest('hex'),
    retrievedAt: new Date().toISOString(),
    bytes,
    coverage: 'complete-within-declared-bound',
  };
}
