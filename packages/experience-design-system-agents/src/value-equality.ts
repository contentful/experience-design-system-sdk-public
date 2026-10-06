type RecordWithUnknownValues = Record<string, unknown>;

export function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const unmatched = [...right];
    return left.every((value) => {
      const matchIndex = unmatched.findIndex((candidate) => sameValue(value, candidate));
      if (matchIndex === -1) return false;
      unmatched.splice(matchIndex, 1);
      return true;
    });
  }

  if (typeof left === 'object' || typeof right === 'object') {
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    const leftRecord = left as RecordWithUnknownValues;
    const rightRecord = right as RecordWithUnknownValues;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]))
    );
  }

  return Object.is(left, right);
}
