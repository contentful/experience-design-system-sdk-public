/**
 * Seed a legacy runs.json (v1 or v2) to exercise the in-memory migration
 * path in `runs/store.ts:migrateRecord`.
 *
 *   v1: no tokensPath / tokenSessionId / sourceFingerprint / savedFingerprint
 *   v2: adds tokensPath + tokenSessionId; still no fingerprints
 *   v3: current — every field present (see seed-runs.mjs)
 *
 * The migrator lifts v1/v2 records into the v3 shape in memory before
 * the picker sees them; the on-disk file version is preserved until the
 * next write.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Write a v1-format runs.json under `<home>/.config/experiences/`.
 *
 * @param {string} home
 * @param {Array<{id?: string, projectPath?: string, componentCount?: number}>} runs
 */
export function seedRunsV1(home, runs) {
  const dir = join(home, '.config', 'experiences');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const filled = runs.map((r, i) => ({
    id: r.id ?? `v1-run-${String(i).padStart(4, '0')}`,
    createdAt: r.createdAt ?? now,
    projectPath: r.projectPath ?? '/tmp/fake-project-v1',
    savePath: r.savePath ?? '/tmp/fake-project-v1/.contentful',
    componentCount: r.componentCount ?? 3,
    tokenCount: r.tokenCount ?? 0,
    agent: r.agent ?? 'claude',
    pushedTo: r.pushedTo ?? null,
    extractSessionId: r.extractSessionId ?? `extract-v1-${i}`,
    generateSessionId: r.generateSessionId ?? `generate-v1-${i}`,
  }));
  const file = { version: 1, runs: filled };
  const path = join(dir, 'runs.json');
  writeFileSync(path, JSON.stringify(file, null, 2));
  return { path, ids: filled.map((r) => r.id) };
}

/**
 * Write a v2-format runs.json under `<home>/.config/experiences/`.
 *
 * @param {string} home
 * @param {Array<any>} runs
 */
export function seedRunsV2(home, runs) {
  const dir = join(home, '.config', 'experiences');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const filled = runs.map((r, i) => ({
    id: r.id ?? `v2-run-${String(i).padStart(4, '0')}`,
    createdAt: r.createdAt ?? now,
    projectPath: r.projectPath ?? '/tmp/fake-project-v2',
    savePath: r.savePath ?? '/tmp/fake-project-v2/.contentful',
    componentCount: r.componentCount ?? 3,
    tokenCount: r.tokenCount ?? 0,
    tokensPath: r.tokensPath ?? null,
    tokenSessionId: r.tokenSessionId ?? null,
    agent: r.agent ?? 'claude',
    pushedTo: r.pushedTo ?? null,
    extractSessionId: r.extractSessionId ?? `extract-v2-${i}`,
    generateSessionId: r.generateSessionId ?? `generate-v2-${i}`,
  }));
  const file = { version: 2, runs: filled };
  const path = join(dir, 'runs.json');
  writeFileSync(path, JSON.stringify(file, null, 2));
  return { path, ids: filled.map((r) => r.id) };
}
