type FileCategory = 'tsx' | 'ts' | 'vue' | 'astro' | 'jsx' | 'js' | 'json' | 'other';

export type FileCounts = Record<FileCategory, number> & { total: number };

export type ScanFailureCode = 'not-found' | 'permission-denied' | 'is-file' | 'not-directory' | 'unreadable';

export type ScanResult =
  | {
      ok: true;
      counts: FileCounts;
      filePaths: string[];
      warnings: string[];
      sourceInventory?: import('@contentful/experience-design-system-backend-pipeline').SourceEvidenceInventory;
    }
  | { ok: false; failure: ScanFailureCode };

export type PathPhase = 'scanning' | 'ready' | 'failed';

export type KeyAction = 'confirm' | 'change-path' | 'back';

export interface SummaryRow {
  label: string;
  count: number;
  tone: 'default' | 'accent' | 'muted';
}

export interface Summary {
  total: number;
  rows: SummaryRow[];
  warning?: string;
}

export interface FailureMessage {
  headline: string;
  hints: string[];
}

interface Key {
  escape: boolean;
  return: boolean;
}

const COMPONENT_CATEGORIES: FileCategory[] = ['tsx', 'ts', 'vue', 'astro', 'jsx', 'js'];

const ROW_LABELS: Record<FileCategory, string> = {
  tsx: '.tsx files',
  ts: '.ts files',
  vue: '.vue files',
  astro: '.astro files',
  jsx: '.jsx files',
  js: '.js files',
  json: '.json files (design tokens)',
  other: 'other (ignored)',
};

const ROW_ORDER: FileCategory[] = ['tsx', 'ts', 'vue', 'astro', 'jsx', 'js', 'json', 'other'];

export function describeFailure(failure: ScanFailureCode, path: string): FailureMessage {
  switch (failure) {
    case 'is-file':
      return {
        headline: "That's a file, not a directory.",
        hints: [
          'Choose an application root, a folder of components, or a folder containing a single component.',
          'Example: ~/projects/my-app/src',
        ],
      };
    case 'not-found':
      return {
        headline: `Directory not found: ${path}`,
        hints: ['Double-check the path and try again. Tip: you can use ~, relative, or absolute paths.'],
      };
    case 'permission-denied':
      return {
        headline: `Permission denied: ${path}`,
        hints: ["You don't have read access to this directory."],
      };
    case 'not-directory':
      return { headline: `Not a directory: ${path}`, hints: [] };
    case 'unreadable':
      return { headline: `Cannot access: ${path}`, hints: [] };
  }
}

/**
 * The scan result as rows and a warning. When the import does not generate tokens (components only), `.json` files are
 * not design tokens here, so the row says they are ignored and the warnings do not mention tokens.
 */
export function summarize(counts: FileCounts, { hasTokens = true }: { hasTokens?: boolean } = {}): Summary {
  const rows = ROW_ORDER.filter((category) => counts[category] > 0).map((category): SummaryRow => {
    if (category === 'json' && !hasTokens) return { label: '.json files (ignored)', count: counts.json, tone: 'muted' };
    const tone = category === 'json' ? 'accent' : category === 'other' ? 'muted' : 'default';
    return { label: ROW_LABELS[category], count: counts[category], tone };
  });

  const componentFiles = COMPONENT_CATEGORIES.reduce((sum, category) => sum + counts[category], 0);
  if (componentFiles > 0) return { total: counts.total, rows };
  if (hasTokens && counts.json > 0) {
    return { total: counts.total, rows, warning: 'No component files found — only token files detected.' };
  }
  return {
    total: counts.total,
    rows,
    warning: hasTokens
      ? 'No component or token files found. Try a different path.'
      : 'No component files found. Try a different path.',
  };
}

export function phaseOf(scan: ScanResult | undefined): PathPhase {
  if (scan === undefined) return 'scanning';
  return scan.ok ? 'ready' : 'failed';
}

export function keyAction(phase: PathPhase, input: string, key: Key): KeyAction | undefined {
  if (key.escape) return 'back';
  if (phase === 'ready') {
    if (key.return) return 'confirm';
    if (input === 'e') return 'change-path';
  }
  if (phase === 'failed' && (key.return || input === 'e')) return 'change-path';
  return undefined;
}
