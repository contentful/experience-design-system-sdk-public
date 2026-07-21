export const CANDIDATE_NAME_PATTERNS: RegExp[] = [/mapping/i, /meta/i, /registry/i, /schema/i, /composition/i];

export const CANDIDATE_CONTENT_MARKERS: string[] = [
  'requiredParent',
  'withParentType',
  'allowedTagNames',
  'createContext',
  'MappingContext',
  'allowedComponents',
];

export const CANDIDATE_TOKEN_BUDGET = 6000;

/**
 * Token ceiling for the candidate set INLINED into a single agent prompt.
 * Sized to stay under a 200k-context model once the agent's own system prompt
 * + tool definitions (~105k observed) are added, so a large design system
 * (hundreds of components → many matched files) can't overflow the request and
 * fail resolution. Files beyond the budget are dropped (with a warning), not
 * silently truncated. Distinct from `CANDIDATE_TOKEN_BUDGET`, which sizes the
 * unused per-batch chunking.
 */
export const PROMPT_CANDIDATE_TOKEN_BUDGET = 80_000;

const CHARS_PER_TOKEN = 4;
const DEFAULT_SLICE_WINDOW = 3;

export type CandidateFile = { path: string; content: string };
export type SelectedCandidate = CandidateFile & { reason: string };

function matchReason(file: CandidateFile): string | undefined {
  // Test the name patterns against EVERY path segment (directory names + the
  // basename), not just the basename. A mapping-layer file that only DEFINES a
  // component — e.g. src/mapping/call_to_action.ts, no withParentType of its
  // own — must still be selected so the resolver can resolve OTHER files'
  // parent references to it. Matching only the basename silently dropped these.
  const segments = file.path.split('/').filter((s) => s !== '');
  for (const pattern of CANDIDATE_NAME_PATTERNS) {
    if (segments.some((seg) => pattern.test(seg))) {
      return `name:${pattern.source.toLowerCase()}`;
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

/**
 * Cap a candidate set to what fits in a single agent prompt (see
 * `PROMPT_CANDIDATE_TOKEN_BUDGET`). Files are kept smallest-first so the budget
 * admits the most declarations; deterministic tie-break by path. Returns the
 * kept files plus the paths dropped so the caller can warn (silent truncation
 * would read as "resolved everything" when it didn't).
 */
export function capCandidatesToPromptBudget<T extends CandidateFile>(
  files: T[],
  budget: number = PROMPT_CANDIDATE_TOKEN_BUDGET,
): { kept: T[]; dropped: T[] } {
  const ordered = [...files].sort((a, b) => a.content.length - b.content.length || a.path.localeCompare(b.path));
  const kept: T[] = [];
  const dropped: T[] = [];
  let spent = 0;
  for (const file of ordered) {
    const cost = tokenCost(file);
    if (spent + cost > budget) {
      dropped.push(file);
      continue;
    }
    kept.push(file);
    spent += cost;
  }
  return { kept, dropped };
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
