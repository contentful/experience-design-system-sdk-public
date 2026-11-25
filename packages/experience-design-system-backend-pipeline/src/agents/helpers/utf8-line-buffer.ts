import { StringDecoder } from 'node:string_decoder';

export function createUtf8LineBuffer() {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return {
    push(chunk: Buffer | string): string[] {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const lines = pending.split('\n');
      pending = lines.pop()!;
      return lines;
    },
    end(): string {
      const rest = pending + decoder.end();
      pending = '';
      return rest;
    },
  };
}
