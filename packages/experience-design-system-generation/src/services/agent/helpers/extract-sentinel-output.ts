export function extractSentinelOutput(stdout: string): string | null | 'multiple' {
  const START = '<<<EDS_OUTPUT_START>>>';
  const END = '<<<EDS_OUTPUT_END>>>';
  const startIdx = stdout.indexOf(START);
  const endIdx = stdout.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  const secondStart = stdout.indexOf(START, startIdx + START.length);
  if (secondStart !== -1 && secondStart < endIdx) return 'multiple';
  const afterStart = stdout.indexOf(END, startIdx);
  const secondEnd = stdout.indexOf(END, afterStart + END.length);
  if (secondEnd !== -1) return 'multiple';
  return stdout.slice(startIdx + START.length, endIdx).trim();
}
