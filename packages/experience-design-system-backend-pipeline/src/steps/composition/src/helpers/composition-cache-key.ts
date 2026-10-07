import { createHash } from 'node:crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function buildCompositionInputHash(input: {
  files: Array<{ path: string; content: string }>;
  agent: string;
}): string {
  const fileDigest = input.files
    .map((f) => `${f.path} ${hashContent(f.content)}`)
    .sort()
    .join('');
  return hashContent(`agent:${input.agent}\n${fileDigest}`);
}
