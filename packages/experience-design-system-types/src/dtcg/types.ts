import * as z from 'zod/mini';
import { DESIGN_TOKEN_TYPES } from './token-types.js';

export const DTCGTokenSchema = z.strictObject({
  path: z.string(),
  $type: z.enum(DESIGN_TOKEN_TYPES),
  $value: z.unknown(),
  $description: z.optional(z.string()),
});

export type DTCGTokenEntry = z.infer<typeof DTCGTokenSchema>;

export interface DTCGTokenGroup {
  path: string;
  $description?: string;
  tokenIds: string[];
}

export type DTCGTokenNode = DTCGTokenLeaf | DTCGTokenGroupNode;

export interface DTCGTokenLeaf {
  $type: string;
  $value: unknown;
  $description?: string;
}

export interface DTCGTokenGroupNode {
  $description?: string;
  [key: string]: DTCGTokenNode | string | undefined;
}
