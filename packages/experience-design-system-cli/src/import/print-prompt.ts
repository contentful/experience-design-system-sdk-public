/**
 * `experiences import --print-prompt` / `--dry-run` — prompt-print helpers.
 *
 * Both flags currently surface the same behaviour: print the generate-prompt
 * (delegated downstream by the orchestrator via `generate components --dry-run`)
 * and exit before invoking the agent. `--print-prompt` is the new, explicit
 * name. `--dry-run` is preserved for one deprecation cycle: it keeps working
 * but emits a stderr notice signalling that its semantics will change in a
 * future release (to "manifest preview, no push", matching `apply push`'s
 * `--dry-run`).
 *
 * Keeping the routing in a small pure module lets the command surface stay
 * declarative and lets the deprecation notice be asserted from tests without
 * spawning the full pipeline.
 */

export const DRY_RUN_DEPRECATION_NOTICE =
  "Warning: '--dry-run' on 'experiences import' will change semantics in a future release; " +
  "use '--print-prompt' to print the prompt or '--dry-run --no-push' to preview the manifest.\n";

export type PromptFlags = {
  /** True when the user passed --dry-run. */
  dryRun?: boolean;
  /** True when the user passed --print-prompt. */
  printPrompt?: boolean;
};

export type PromptFlagsResolution = {
  /** Whether to forward `--dry-run` semantics to the downstream generate step. */
  forwardDryRun: boolean;
  /** Stderr message to emit, or null when the flags need no warning. */
  deprecationNotice: string | null;
};

/**
 * Resolve the user's `--dry-run` / `--print-prompt` choice into the
 * downstream-forwarded dry-run boolean plus an optional deprecation message.
 * Pure (no IO) so it's trivially unit-testable; the caller writes the notice
 * to stderr.
 */
export function resolvePromptFlags(flags: PromptFlags): PromptFlagsResolution {
  const forwardDryRun = !!(flags.dryRun || flags.printPrompt);
  // Only the bare `--dry-run` path emits the deprecation notice; pairing it
  // with `--print-prompt` (or using `--print-prompt` alone) opts the operator
  // into the new explicit name, so we stay quiet.
  const deprecationNotice =
    flags.dryRun && !flags.printPrompt ? DRY_RUN_DEPRECATION_NOTICE : null;
  return { forwardDryRun, deprecationNotice };
}
