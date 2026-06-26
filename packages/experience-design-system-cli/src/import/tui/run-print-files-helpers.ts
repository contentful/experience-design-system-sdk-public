/**
 * Computes the wizard state patch applied after `runPrintFiles` successfully
 * writes components.json. Default behavior transitions to the print-gate
 * confirm screen. When `skipGate: true` is passed (used by the "save AND push"
 * path), the transition is suppressed so the caller can chain into
 * `runPreview` without an intermediate gate render.
 */
export type NextStateAfterPrintInput = {
  skipGate?: boolean;
  componentsPath: string;
};

export type NextStateAfterPrintOutput =
  | { componentsPath: string }
  | { step: 'print-gate'; componentsPath: string };

export function nextStateAfterPrint(
  opts: NextStateAfterPrintInput,
): NextStateAfterPrintOutput {
  if (opts.skipGate) {
    return { componentsPath: opts.componentsPath };
  }
  return { step: 'print-gate', componentsPath: opts.componentsPath };
}
