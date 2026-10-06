export type AiFlaggable = {
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
};

export function isAiFlagged(row: AiFlaggable): boolean {
  return row.aiDecision === 'rejected' || row.aiDecision === 'failed';
}

export function isDefaultIncluded(row: AiFlaggable): boolean {
  return !isAiFlagged(row);
}
