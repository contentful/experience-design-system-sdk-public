import type {
  VerifyEvidence,
  VerifyComponentWork,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
export function checkEvidence(
  evidence: VerifyEvidence[],
  text: string,
  sources: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  if (!evidence.length) return { ok: false, reason: 'No cited evidence' };
  const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();
  for (const entry of evidence)
    if (!sources.has(entry.source) || !normalize(entry.quote) || !normalize(text).includes(normalize(entry.quote)))
      return { ok: false, reason: 'Cited source or quote was not supplied' };
  return { ok: true };
}
export function checkBoundEvidence(
  evidence: VerifyEvidence[],
  work: VerifyComponentWork,
  sourceInput?: ExplorationSourceInput,
): boolean {
  if (!evidence.length || sourceInput?.extractionByteBinding === 'changed') return false;
  return evidence.every((entry) => {
    const match = /^(\d+)(?:[-–:](\d+))?$/.exec(entry.line.trim());
    if (!match) return false;
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || !entry.quote.trim()) return false;
    if (sourceInput) {
      const file = sourceInput.files.find((file) => file.path === entry.source);
      return !!file?.ranges.some(
        (range) =>
          start >= range.startLine &&
          end <= range.endLine &&
          range.text
            .split('\n')
            .slice(start - range.startLine, end - range.startLine + 1)
            .join('\n')
            .includes(entry.quote),
      );
    }
    const ref = work.sourceRef;
    const source =
      ref?.sourcePath === entry.source
        ? { content: ref.content, metadata: ref.sourceEvidence }
        : ref?.siblingFiles?.find((file) => file.path === entry.source);
    if (!source?.content) return false;
    const metadata = 'metadata' in source ? source.metadata : source.sourceEvidence;
    if (
      !metadata ||
      metadata.extractionByteBinding === 'changed' ||
      metadata.coverage !== 'complete-within-declared-bound'
    )
      return false;
    return (
      metadata.lineRanges.some((range) => start >= range.startLine && end <= range.endLine) &&
      source.content
        .split('\n')
        .slice(start - 1, end)
        .join('\n')
        .includes(entry.quote)
    );
  });
}
