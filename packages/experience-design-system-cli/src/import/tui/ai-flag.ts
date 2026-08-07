export type AiFlaggable = {
  aiDecision?: 'accepted' | 'rejected' | 'failed' | null;
  needsReview?: boolean;
};

export function isAiFlagged(row: AiFlaggable): boolean {
  return row.needsReview === true || row.aiDecision === 'rejected' || row.aiDecision === 'failed';
}

export function isDefaultIncluded(row: AiFlaggable): boolean {
  return !isAiFlagged(row);
}
