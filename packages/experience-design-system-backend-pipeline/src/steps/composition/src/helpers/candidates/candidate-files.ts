import { CANDIDATE_NAME_PATTERNS, CANDIDATE_CONTENT_MARKERS } from '../../constants/index.js';
import type { CandidateFile, SelectedCandidate } from '../../types/contract.js';

export type { CandidateFile, SelectedCandidate };

function getMatchReason(file: CandidateFile): string | undefined {
  const segments = file.path.split('/').filter((s) => s !== '');
  for (const pattern of CANDIDATE_NAME_PATTERNS) {
    if (segments.some((seg) => pattern.test(seg))) return `name:${pattern.source.toLowerCase()}`;
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
    const matchReason = getMatchReason(file);
    if (matchReason === undefined) continue;
    seen.add(file.path);
    selected.push({ path: file.path, content: file.content, matchReason });
  }
  return selected;
}
