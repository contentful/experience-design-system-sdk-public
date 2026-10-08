export type SourceFileEntry = { mtime: string; componentName?: string };

export type SourceFingerprint = {
  files: Record<string, SourceFileEntry>;
  rawTokensPath: string | null;
  rawTokensMtime: string | null;
  rawTokensContentHash: string | null;
};

export interface RawComponentsDb {
  prepare(sql: string): { all(sessionId: string): Array<Record<string, unknown>> };
}
