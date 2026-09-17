import { createHash } from 'node:crypto';

/**
 * Hash the trimmed raw content of a token file. Used as the primary key in
 * the `generation_cache` table for token-set entries so we can skip
 * regenerating token mappings when the source file is unchanged.
 */
export function hashTokenContent(rawTokenContent: string): string {
  return createHash('sha256').update(rawTokenContent.trim()).digest('hex');
}
