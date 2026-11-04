export type { DTCGTokenEntry } from '@contentful/experience-design-system-types';

export interface DTCGTokenGroup {
  path: string;
  $description?: string;
  tokenIds: string[];
}

type DTCGTokenNode = DTCGTokenLeaf | DTCGTokenGroupNode;

interface DTCGTokenLeaf {
  $type: string;
  $value: unknown;
  $description?: string;
}

export interface DTCGTokenGroupNode {
  $description?: string;
  [key: string]: DTCGTokenNode | string | undefined;
}
