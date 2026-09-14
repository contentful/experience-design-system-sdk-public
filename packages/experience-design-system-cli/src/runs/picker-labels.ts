// Pure helpers for the interactive run picker:
//  * disambiguateLabels — turns a list of project paths into short, unique
//    row labels (leaf dir; expanded to parent/leaf on collision).
//  * formatRelativeTime — humanises `createdAt` timestamps (just now / Nm /
//    Nh / Nd), falling back to `YYYY-MM-DD HH:MM` past a week.

export type LabelInput = {
  id: string;
  projectPath: string;
};

function pathSegments(projectPath: string): string[] {
  const normalised = projectPath.replace(/\\/g, '/');
  return normalised.split('/').filter((s) => s.length > 0);
}

/**
 * Map each run to a display label. Labels start as the project path's leaf
 * directory and expand one segment at a time (`<parent>/<leaf>`,
 * `<gp>/<parent>/<leaf>`, …) until every label in the input set is unique.
 * When two rows share the exact same absolute path, the collision is broken
 * with numeric suffixes (`(#1)`, `(#2)`, …) in input order.
 */
export function disambiguateLabels(runs: readonly LabelInput[]): Map<string, string> {
  type Entry = { id: string; segments: string[]; level: number };
  const entries: Entry[] = runs.map((r) => ({
    id: r.id,
    segments: pathSegments(r.projectPath),
    level: 1,
  }));

  const labelAt = (e: Entry): string => {
    if (e.segments.length === 0) return e.id;
    const take = Math.min(e.level, e.segments.length);
    return e.segments.slice(-take).join('/');
  };

  let stable = false;
  while (!stable) {
    stable = true;
    const groups = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = labelAt(e);
      const arr = groups.get(key);
      if (arr) arr.push(e);
      else groups.set(key, [e]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const anyExpandable = group.some((e) => e.level < e.segments.length);
      if (!anyExpandable) continue;
      for (const e of group) {
        if (e.level < e.segments.length) e.level += 1;
      }
      stable = false;
    }
  }

  const result = new Map<string, string>();
  const orderedGroups: Entry[][] = [];
  const byLabel = new Map<string, Entry[]>();
  for (const e of entries) {
    const key = labelAt(e);
    const existing = byLabel.get(key);
    if (existing) {
      existing.push(e);
    } else {
      const fresh: Entry[] = [e];
      byLabel.set(key, fresh);
      orderedGroups.push(fresh);
    }
  }
  for (const group of orderedGroups) {
    if (group.length === 1) {
      const only = group[0]!;
      result.set(only.id, labelAt(only));
    } else {
      group.forEach((e, i) => {
        result.set(e.id, `${labelAt(e)} (#${i + 1})`);
      });
    }
  }
  return result;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format an ISO-8601 timestamp relative to `now`. Buckets:
 *   < 60s      → "just now"
 *   < 60 min   → "Nm ago"
 *   < 24 h     → "Nh ago"
 *   < 7 days   → "Nd ago"
 *   otherwise  → "YYYY-MM-DD HH:MM" (local time)
 *
 * Future timestamps (created after `now`) also render as "just now" — they
 * only occur with clock skew and the delta is not worth surfacing.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return `${then.getFullYear()}-${pad2(then.getMonth() + 1)}-${pad2(then.getDate())} ${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
}
