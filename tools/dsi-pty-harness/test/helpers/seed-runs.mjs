/**
 * Seed helpers for `~/.config/experiences/runs.json`. Used to preload a
 * fake run record before invoking `experiences import --modify <id>` or
 * `--push-from-run <id>` so we can exercise those flag paths without a
 * real prior wizard session.
 *
 * All helpers take a `home` path (from `makeTmpHome()`) and write into
 * `<home>/.config/experiences/`. They never touch the real user config.
 *
 * See packages/experience-design-system-cli/src/runs/store.ts for the
 * on-disk schema (RunRecord, RUNS_FILE_VERSION=3).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Seed a runs.json with one or more RunRecord objects.
 *
 * @param {string}    home  from makeTmpHome().home
 * @param {object[]}  runs  partial RunRecord objects — required fields
 *                          are filled with sensible defaults
 * @returns {{ path: string, ids: string[] }} the seeded runs.json path
 *   and the ids of the seeded runs (matching input order).
 */
export function seedRuns(home, runs) {
  const dir = join(home, '.config', 'experiences');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const filled = runs.map((r, i) => ({
    id: r.id ?? `test-run-${String(i).padStart(4, '0')}`,
    createdAt: r.createdAt ?? now,
    projectPath: r.projectPath ?? '/tmp/fake-project',
    savePath: r.savePath ?? '/tmp/fake-project/.contentful',
    componentCount: r.componentCount ?? 3,
    tokenCount: r.tokenCount ?? 0,
    tokensPath: r.tokensPath ?? null,
    tokenSessionId: r.tokenSessionId ?? null,
    agent: r.agent ?? 'claude',
    pushedTo: r.pushedTo ?? null,
    extractSessionId: r.extractSessionId ?? `extract-sess-${i}`,
    generateSessionId: r.generateSessionId ?? `generate-sess-${i}`,
    sourceFingerprint: r.sourceFingerprint ?? null,
    savedFingerprint: r.savedFingerprint ?? null,
    ...(r.notes ? { notes: r.notes } : {}),
  }));
  const file = { version: 3, runs: filled };
  const path = join(dir, 'runs.json');
  writeFileSync(path, JSON.stringify(file, null, 2));
  return { path, ids: filled.map((r) => r.id) };
}
