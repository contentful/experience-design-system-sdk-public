import type { SourceFingerprint } from './source-fingerprint.js';

export const RUNS_FILE_VERSION = 3 as const;
export const READABLE_VERSIONS = new Set<number>([1, 2, 3]);

export type RunRecord = {
  id: string;
  createdAt: string;
  projectPath: string;
  savePath: string;
  componentCount: number;
  tokenCount: number;
  tokensPath: string | null;
  tokenSessionId: string | null;
  agent: string;
  pushedTo: { spaceId: string; environmentId: string; host: string } | null;
  extractSessionId: string;
  generateSessionId: string | null;
  sourceFingerprint?: SourceFingerprint | null;
  notes?: string;
};

export type RunsFile = {
  version: typeof RUNS_FILE_VERSION;
  runs: RunRecord[];
};

export type RunRecordV1 = Omit<RunRecord, 'tokensPath' | 'tokenSessionId' | 'sourceFingerprint'>;
export type RunRecordV2 = Omit<RunRecord, 'sourceFingerprint'>;
export type RunsFileV1 = { version: 1; runs: RunRecordV1[] };
export type RunsFileV2 = { version: 2; runs: RunRecordV2[] };

export type AppendInput = Omit<RunRecord, 'id' | 'createdAt'> & Partial<Pick<RunRecord, 'id' | 'createdAt'>>;

export type ListOptions = {
  limit?: number;
  projectPath?: string;
  before?: string;
  after?: string;
};
