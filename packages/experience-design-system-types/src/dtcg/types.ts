import type { DesignTokenType } from './token-types.js';

export interface DTCGTokenEntry {
  path: string;
  $type: DesignTokenType;
  $value: unknown;
  $description?: string;
}

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
