type FileCategory = 'tsx' | 'ts' | 'vue' | 'astro' | 'jsx' | 'js' | 'json' | 'other';

export type FileCounts = Record<FileCategory, number> & { total: number };

export type ScanFailureCode = 'not-found' | 'permission-denied' | 'is-file' | 'not-directory' | 'unreadable';

export type ScanResult = { ok: true; counts: FileCounts } | { ok: false; failure: ScanFailureCode };

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

export const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'storybook-static',
  'out',
  '.git',
]);

const CATEGORY_BY_EXTENSION = new Map<string, FileCategory>([
  ['tsx', 'tsx'],
  ['ts', 'ts'],
  ['vue', 'vue'],
  ['astro', 'astro'],
  ['jsx', 'jsx'],
  ['js', 'js'],
  ['json', 'json'],
]);

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

function categorize(fileName: string): FileCategory {
  if (fileName.endsWith('.d.ts')) return 'other';
  const dot = fileName.lastIndexOf('.');
  const extension = dot === -1 ? '' : fileName.slice(dot + 1);
  return CATEGORY_BY_EXTENSION.get(extension) ?? 'other';
}

export function emptyCounts(): FileCounts {
  return { tsx: 0, ts: 0, vue: 0, astro: 0, jsx: 0, js: 0, json: 0, other: 0, total: 0 };
}

export function addFile(counts: FileCounts, fileName: string): FileCounts {
  const category = categorize(fileName);
  return { ...counts, [category]: counts[category] + 1, total: counts.total + 1 };
}

export function mergeCounts(a: FileCounts, b: FileCounts): FileCounts {
  return {
    tsx: a.tsx + b.tsx,
    ts: a.ts + b.ts,
    vue: a.vue + b.vue,
    astro: a.astro + b.astro,
    jsx: a.jsx + b.jsx,
    js: a.js + b.js,
    json: a.json + b.json,
    other: a.other + b.other,
    total: a.total + b.total,
  };
}

export function failureFromErrorCode(code: string | undefined): ScanFailureCode {
  if (code === 'ENOENT') return 'not-found';
  if (code === 'EACCES') return 'permission-denied';
  return 'unreadable';
}

export function describeFailure(failure: ScanFailureCode, path: string): FailureMessage {
  switch (failure) {
    case 'is-file':
      return {
        headline: "That's a file, not a directory.",
        hints: [
          "Provide the path to your component library's root folder, not a specific file.",
          'Example: ~/projects/my-design-system',
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

export function summarize(counts: FileCounts): Summary {
  const rows = ROW_ORDER.filter((category) => counts[category] > 0).map((category): SummaryRow => {
    const tone = category === 'json' ? 'accent' : category === 'other' ? 'muted' : 'default';
    return { label: ROW_LABELS[category], count: counts[category], tone };
  });

  const componentFiles = COMPONENT_CATEGORIES.reduce((sum, category) => sum + counts[category], 0);
  if (componentFiles > 0) return { total: counts.total, rows };
  if (counts.json > 0) {
    return { total: counts.total, rows, warning: 'No component files found — only token files detected.' };
  }
  return {
    total: counts.total,
    rows,
    warning: 'No component or token files found. Try a different path.',
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
