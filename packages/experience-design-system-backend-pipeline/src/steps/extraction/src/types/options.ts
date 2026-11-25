export interface ExtractorOptions {
  evidenceFilePaths?: readonly string[];
  resolveUnreachable?: 'auto' | 'always' | 'never';
  projectRoot?: string;
  signal?: AbortSignal;
}
