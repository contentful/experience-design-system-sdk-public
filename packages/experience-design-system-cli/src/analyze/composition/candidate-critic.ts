/**
 * Completeness critic for the candidate-file filter (design: the heuristic can
 * miss a composition-layer directory whose name we didn't anticipate). We show
 * the agent the DIRECTORIES it did NOT pick — names only, no file contents, so
 * it's cheap — and let it flag ones that look promising from the path alone.
 * Flagged dirs' files are folded into the prompt sample.
 *
 * This only widens the AUTHORING-PROMPT sample; the parser already runs over
 * every file at runtime, so this is purely "help the agent see the convention",
 * never a correctness dependency.
 */

type FileLike = { path: string; content: string };

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Directories present in `all` but with no file in `selected`, sorted+deduped. */
export function uncoveredDirectories(all: FileLike[], selected: FileLike[]): string[] {
  const coveredDirs = new Set(selected.map((f) => dirOf(f.path)));
  const out = new Set<string>();
  for (const f of all) {
    const d = dirOf(f.path);
    if (d !== '' && !coveredDirs.has(d)) out.add(d);
  }
  return [...out].sort();
}

/** Union `selected` with every `all` file whose directory is in `chosenDirs`. */
export function expandCandidatesByDirs(all: FileLike[], selected: FileLike[], chosenDirs: string[]): FileLike[] {
  const chosen = new Set(chosenDirs);
  const seen = new Set(selected.map((f) => f.path));
  const out = [...selected];
  for (const f of all) {
    if (chosen.has(dirOf(f.path)) && !seen.has(f.path)) {
      seen.add(f.path);
      out.push(f);
    }
  }
  return out;
}

export type CritiqueResult = { files: FileLike[]; addedDirs: string[] };

/**
 * Run the completeness critic. `askDirs` receives the uncovered directory names
 * and returns the subset the agent judges composition-relevant. We only honor
 * dirs that were actually offered (no injection), and any error from the agent
 * falls back to the original selection — the critic can only ever ADD, never
 * break resolution.
 */
export async function critiqueCandidates(
  all: FileLike[],
  selected: FileLike[],
  askDirs: (dirs: string[]) => Promise<string[]>,
): Promise<CritiqueResult> {
  const uncovered = uncoveredDirectories(all, selected);
  if (uncovered.length === 0) return { files: selected, addedDirs: [] };

  let chosen: string[];
  try {
    chosen = await askDirs(uncovered);
  } catch {
    return { files: selected, addedDirs: [] };
  }

  const offered = new Set(uncovered);
  const addedDirs = [...new Set(chosen)].filter((d) => offered.has(d)).sort();
  if (addedDirs.length === 0) return { files: selected, addedDirs: [] };

  return { files: expandCandidatesByDirs(all, selected, addedDirs), addedDirs };
}
