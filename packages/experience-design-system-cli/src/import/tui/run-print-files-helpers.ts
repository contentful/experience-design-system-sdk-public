/**
 * Computes the wizard state patch applied after `runPrintFiles` successfully
 * writes components.json. Default behavior transitions to the print-gate
 * confirm screen. When `skipGate: true` is passed (used by the "save AND push"
 * path), the transition is suppressed so the caller can chain into
 * `runPreview` without an intermediate gate render.
 *
 * When `outDir` is provided (Task 4 — operator chose a custom save path via
 * the inline path-prompt), it is folded into the patch so the wizard's
 * `state.outDir` reflects the chosen path. Subsequent reads (e.g. the
 * appendRun call, the print-gate's summary) pick it up automatically.
 */
export type NextStateAfterPrintInput = {
  skipGate?: boolean;
  componentsPath: string;
  outDir?: string;
};

export type NextStateAfterPrintOutput =
  | { componentsPath: string; outDir?: string }
  | { step: 'print-gate'; componentsPath: string; outDir?: string };

export function nextStateAfterPrint(opts: NextStateAfterPrintInput): NextStateAfterPrintOutput {
  const base = opts.outDir
    ? { componentsPath: opts.componentsPath, outDir: opts.outDir }
    : { componentsPath: opts.componentsPath };
  if (opts.skipGate) return base;
  return { step: 'print-gate', ...base };
}
