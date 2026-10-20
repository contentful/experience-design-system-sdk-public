import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { RendererReferenceInput, RendererReference } from '@contentful/experience-design-system-types';
import { throwIfAborted } from '../../../helpers/abort.js';
export const SDK_REFERENCE_URL = 'https://raw.githubusercontent.com/contentful/experiences/main/README.md';
export async function loadRendererReference(
  input: RendererReferenceInput = { kind: 'url' },
  options: { signal?: AbortSignal; maxBytes?: number; fetchText?: typeof fetch } = {},
): Promise<RendererReference> {
  throwIfAborted(options.signal);
  let text: string, origin: string;
  if (input.kind === 'text') {
    text = input.text;
    origin = input.origin;
  } else if (input.kind === 'path') {
    origin = input.path;
    const file = await open(input.path, 'r');
    try {
      const buffer = Buffer.alloc((options.maxBytes ?? 64 * 1024) + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        throwIfAborted(options.signal);
        const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
      }
      text = buffer.subarray(0, bytes).toString('utf8');
    } finally {
      await file.close();
    }
  } else {
    origin = input.url ?? SDK_REFERENCE_URL;
    const response = await (options.fetchText ?? fetch)(origin, {
      signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new Error('Renderer reference fetch failed');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Renderer reference response body unavailable');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > (options.maxBytes ?? 64 * 1024)) throw new Error('Renderer reference exceeds byte bound');
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
  if (!text.trim() || bytes > (options.maxBytes ?? 64 * 1024))
    throw new Error('Renderer reference is empty or exceeds byte bound');
  return {
    origin,
    text,
    digest: createHash('sha256').update(text).digest('hex'),
    retrievedAt: new Date().toISOString(),
    bytes,
    coverage: 'complete-within-declared-bound',
  };
}
