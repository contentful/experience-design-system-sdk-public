// Pure helpers for shaping the auto-filter subprocess stderr stream into a
// human-readable error tail. The auto-filter (select-agent) subprocess emits
// three classes of lines on stderr:
//
//   1. `progress=...` machine-parseable progress lines consumed by the wizard
//      to drive `aiDecisions` / `aiFilterProgress` state.
//   2. `[N/total] Name <verb> ...` per-component status lines (human-readable
//      mirror of the progress emission).
//   3. Free-form error output — what we actually want to surface on failure.
//
// `buildAutoFilterErrorTail` strips classes (1) and (2) plus ANSI color
// escapes, then returns the last 3 lines joined with " / " (matching the
// pre-existing tail format in WizardApp.tsx).
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const PROGRESS_RE = /^progress=/;
const PER_COMPONENT_RE = /\[\d+\/\d+\]/;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function isStructured(line: string): boolean {
  return PROGRESS_RE.test(line) || PER_COMPONENT_RE.test(line);
}

export function buildAutoFilterErrorTail(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => stripAnsi(l.trim()))
    .filter((l) => l.length > 0 && !isStructured(l));
  return lines.slice(-3).join(' / ');
}
