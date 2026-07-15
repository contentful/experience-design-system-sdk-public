export const CANDIDATE_NAME_PATTERNS: RegExp[] = [/mapping/i, /meta/i];

export const CANDIDATE_CONTENT_MARKERS: string[] = [
  'requiredParent',
  'withParentType',
  'allowedTagNames',
  'createContext',
];

export const CANDIDATE_TOKEN_BUDGET = 6000;

const CHARS_PER_TOKEN = 4;
const DEFAULT_SLICE_WINDOW = 3;

export type CandidateFile = { path: string; content: string };
export type SelectedCandidate = CandidateFile & { reason: string };

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function matchReason(file: CandidateFile): string | undefined {
  const name = basename(file.path);
  for (const pattern of CANDIDATE_NAME_PATTERNS) {
    if (pattern.test(name)) {
      const label = pattern.source.toLowerCase();
      return `name:${label}`;
    }
  }
  for (const marker of CANDIDATE_CONTENT_MARKERS) {
    if (file.content.includes(marker)) return `content:${marker}`;
  }
  return undefined;
}

export function selectCandidateFiles(files: CandidateFile[]): SelectedCandidate[] {
  const selected: SelectedCandidate[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.path)) continue;
    const reason = matchReason(file);
    if (reason === undefined) continue;
    seen.add(file.path);
    selected.push({ path: file.path, content: file.content, reason });
  }
  return selected;
}

export function sliceDeclarationRegions(
  content: string,
  markers: string[] = CANDIDATE_CONTENT_MARKERS,
  window = DEFAULT_SLICE_WINDOW,
): string[] {
  const lines = content.split('\n');
  const hitLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (markers.some((marker) => lines[i].includes(marker))) hitLines.push(i);
  }
  if (hitLines.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const hit of hitLines) {
    const start = Math.max(0, hit - window);
    const end = Math.min(lines.length - 1, hit + window);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((r) => lines.slice(r.start, r.end + 1).join('\n'));
}

function tokenCost(file: CandidateFile): number {
  return Math.ceil(file.content.length / CHARS_PER_TOKEN);
}

export function batchCandidates(files: CandidateFile[], budget: number = CANDIDATE_TOKEN_BUDGET): CandidateFile[][] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const batches: CandidateFile[][] = [];
  let current: CandidateFile[] = [];
  let currentCost = 0;

  for (const file of sorted) {
    const cost = tokenCost(file);
    if (cost > budget) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
        currentCost = 0;
      }
      batches.push([file]);
      continue;
    }
    if (current.length > 0 && currentCost + cost > budget) {
      batches.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(file);
    currentCost += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
