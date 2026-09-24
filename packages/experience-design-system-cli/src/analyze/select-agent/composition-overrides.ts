import type { RawComponentDefinition } from '../../types.js';

export type SelectionDecision = 'accepted' | 'rejected' | null;

/**
 * Self-heal (INTEG): composition mapping runs on the FULL extracted set
 * before selection narrows it down, so a component the AI/validation gate
 * rejects can still be a real structural dependency of an accepted
 * component's slot (e.g. `IconButton`'s `children` slot allows `Icon`, but
 * `Icon` itself got auto-rejected as a trivial wrapper).
 *
 * Composition is the higher-fidelity signal here — it reflects actual JSX
 * usage in the source, not the AI's per-component judgment call — so any
 * name a currently-accepted component's `$allowedComponents`/`slots`
 * reference gets forced back to `'accepted'`, overriding a prior rejection.
 * Runs to a fixed point: force-accepting a component can itself introduce
 * new referenced names (transitive dependencies), so this repeats until no
 * further overrides are produced.
 *
 * Returns only the *changed* entries (name → 'accepted'), for callers to
 * merge into their own decision/reason maps and log.
 */
export function overrideRejectionsForCompositionDependencies<T extends Pick<RawComponentDefinition, 'name' | 'slots'>>(
  components: ReadonlyArray<T>,
  decisions: ReadonlyMap<string, SelectionDecision>,
  keyFor: (component: T) => string,
): Map<string, string> {
  const entries = components.map((c) => ({ component: c, key: keyFor(c) }));
  const byName = new Map(entries.map((e) => [e.component.name, e]));
  const overridden = new Map<string, string>();

  const effectiveDecision = (key: string): SelectionDecision =>
    overridden.has(key) ? 'accepted' : (decisions.get(key) ?? null);

  let changedInPass = true;
  while (changedInPass) {
    changedInPass = false;

    for (const { component, key } of entries) {
      if (effectiveDecision(key) !== 'accepted') continue;

      for (const slot of component.slots) {
        for (const allowed of slot.allowedComponents ?? []) {
          const target = byName.get(allowed);
          if (!target) continue; // not in this session — nothing to override
          if (effectiveDecision(target.key) === 'accepted') continue;

          overridden.set(target.key, allowed);
          changedInPass = true;
        }
      }
    }
  }

  return overridden;
}
