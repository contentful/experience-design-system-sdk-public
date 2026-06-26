/**
 * Shared harness for the cache integration suite. Centralizes:
 *
 *  - a scripted fake `claude` binary on PATH whose stdout per invocation is
 *    driven by a callback (Strategy C — fake binary on PATH), keeping LLM
 *    calls deterministic and offline;
 *  - a per-test temp `pipeline.db` plus a temp project dir, wired through the
 *    same `EDS_PIPELINE_DB_PATH` env-var path the CLI uses in production;
 *  - direct sqlite read helpers so tests can assert cache state without re-
 *    parsing CLI output.
 */
import { mkdtemp, rm, writeFile, chmod, mkdir, readFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  openPipelineDb,
  storeRawComponents,
  storeScannedFiles,
  getOrCreateSession,
  createStep,
  updateStep,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

export type AgentInvocation = {
  /** Full prompt passed as the last positional arg to `claude --print --model X <prompt>`. */
  prompt: string;
  /** Names appearing in the prompt rawComponents block (cheap heuristic for select/generate skills). */
  componentNames: string[];
};

export type AgentResponder = (inv: AgentInvocation) => string;

export type ScriptedAgent = {
  dir: string;
  countFile: string;
  logFile: string;
  callCount(): Promise<number>;
  callLog(): Promise<AgentInvocation[]>;
  cleanup(): Promise<void>;
  env(): Record<string, string>;
};

/**
 * Spawn a fake `claude` binary onto a temp dir's PATH. The binary is a tiny
 * node script that:
 *
 *   1. reads its last positional arg (the prompt) and parses the inline
 *      rawComponents block for component names,
 *   2. logs the invocation to a JSONL file the test can read back, and
 *   3. delegates the stdout payload to the JS-side responder via a sidecar
 *      file that the binary tails after writing the prompt.
 *
 * For determinism the responder runs inside the binary process — we serialize
 * it as source code into the script.
 */
export async function createScriptedAgent(responderSource: string): Promise<ScriptedAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'cache-harness-agent-'));
  const countFile = join(dir, 'count.txt');
  const logFile = join(dir, 'calls.jsonl');
  const scriptPath = join(dir, 'claude');

  const body = `#!/usr/bin/env node
// Fake \`claude\`: parse last arg as prompt, log it, echo responder output.
const { writeFileSync, appendFileSync, readFileSync, existsSync } = require('node:fs');
const args = process.argv.slice(2);
const prompt = args[args.length - 1] ?? '';
// Heuristic name extraction from the inline rawComponents JSON block.
const componentNames = [];
const re = /"name"\\s*:\\s*"([^"]+)"/g;
let m;
while ((m = re.exec(prompt)) !== null) componentNames.push(m[1]);
const inv = { prompt, componentNames };
appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(inv) + '\\n');
const prev = existsSync(${JSON.stringify(countFile)}) ? Number(readFileSync(${JSON.stringify(countFile)}, 'utf8').trim() || '0') : 0;
writeFileSync(${JSON.stringify(countFile)}, String(prev + 1));
const responder = ${responderSource};
const out = responder(inv);
process.stdout.write(out);
process.exit(0);
`;
  await writeFile(scriptPath, body, 'utf8');
  await chmod(scriptPath, 0o755);

  return {
    dir,
    countFile,
    logFile,
    async callCount() {
      if (!existsSync(countFile)) return 0;
      return Number((await readFile(countFile, 'utf8')).trim() || '0');
    },
    async callLog() {
      if (!existsSync(logFile)) return [];
      const raw = await readFile(logFile, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AgentInvocation);
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
    env: () => ({ PATH: `${dir}:${process.env.PATH ?? ''}` }),
  };
}

/**
 * Responder factory: emits one select_component tool call per name in the
 * prompt. Acceptance behavior is parameterized via a name->decision map.
 */
export function selectAllResponderSource(
  defaults: 'accept' | 'reject' = 'accept',
  perName: Record<string, 'accept' | 'reject'> = {},
): string {
  return `function(inv) {
    const decisions = ${JSON.stringify(perName)};
    const def = ${JSON.stringify(defaults)};
    const lines = [];
    for (const name of inv.componentNames) {
      const d = decisions[name] ?? def;
      const tool = d === 'accept' ? 'select_component' : 'reject_component';
      lines.push(JSON.stringify({ tool, name, reason: 'harness-' + d, confidence: 5 }));
    }
    return lines.join('\\n') + '\\n';
  }`;
}

/**
 * Responder source: emit one classify_component + classify_prop per prop and
 * classify_slot per slot for every component name in the prompt. This is the
 * minimum tool-call surface for `generate components` to apply changes and
 * write a generation_cache row.
 */
export function generateComponentsResponderSource(): string {
  return `function(inv) {
    const lines = [];
    // Parse out props and slots per component from the inline JSON block.
    // The prompt has a single inlined JSON array containing component objects.
    // Extract each {...} component object by bracket-matching.
    const start = inv.prompt.indexOf('[');
    const end = inv.prompt.lastIndexOf(']');
    let comps = [];
    if (start >= 0 && end > start) {
      try { comps = JSON.parse(inv.prompt.slice(start, end + 1)); } catch {}
    }
    for (const c of comps) {
      if (!c || typeof c !== 'object' || !c.name) continue;
      lines.push(JSON.stringify({ tool: 'classify_component', name: c.name, description: 'harness desc' }));
      for (const p of (c.props ?? [])) {
        lines.push(JSON.stringify({
          tool: 'classify_prop', prop: p.name, cdf_type: 'string', cdf_category: 'content', required: !!p.required,
        }));
      }
      for (const s of (c.slots ?? [])) {
        lines.push(JSON.stringify({
          tool: 'classify_slot', slot: s.name, required: false, description: 'harness slot',
        }));
      }
    }
    return lines.join('\\n') + '\\n';
  }`;
}

/** Responder source: emit set_group + set_token for a fixed token tree. */
export function generateTokensResponderSource(): string {
  return `function(inv) {
    const lines = [
      JSON.stringify({ tool: 'set_group', path: 'colors' }),
      JSON.stringify({ tool: 'set_token', path: 'colors.brand', type: 'color', value: '#abcdef' }),
    ];
    return lines.join('\\n') + '\\n';
  }`;
}

export type CacheFixture = {
  dbPath: string;
  dbDir: string;
  projectDir: string;
  artifactsDir: string;
  sessionId: string;
  components: RawComponentDefinition[];
  extractAgain(
    newComponents: RawComponentDefinition[],
    sourceMap?: Record<string, string>,
  ): Promise<{ sessionId: string }>;
  seedAcceptedSnapshot(): Promise<void>;
  cleanup(): Promise<void>;
};

/**
 * Create a per-test pipeline.db + project dir, seed it with `components`, and
 * write a session row representing a completed `analyze extract` step. Source
 * file contents per component default to `// stub <name>` unless `sourceMap`
 * overrides per-relative-path.
 */
export async function createCacheFixture(
  components: RawComponentDefinition[],
  sourceMap: Record<string, string> = {},
): Promise<CacheFixture> {
  const dbDir = await mkdtemp(join(tmpdir(), 'cache-integ-db-'));
  const projectDir = await mkdtemp(join(tmpdir(), 'cache-integ-proj-'));
  const artifactsDir = await mkdtemp(join(tmpdir(), 'cache-integ-art-'));
  const dbPath = join(dbDir, 'pipeline.db');

  for (const c of components) {
    const abs = join(projectDir, c.source);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, sourceMap[c.source] ?? `// stub ${c.name}`, 'utf8');
  }

  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, components);
  storeScannedFiles(db, sessionId, components.map((c) => c.source));
  // Mark the extract step complete so resolveSessionId() defaults work if
  // tests omit --session.
  const stepId = createStep(db, sessionId, 'analyze extract', { project: projectDir });
  updateStep(db, stepId, 'complete', { sessionId });
  db.close();

  return {
    dbPath,
    dbDir,
    projectDir,
    artifactsDir,
    sessionId,
    components,
    async extractAgain(newComponents, newSourceMap = {}) {
      const map = { ...sourceMap, ...newSourceMap };
      for (const c of newComponents) {
        const abs = join(projectDir, c.source);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, map[c.source] ?? `// stub ${c.name}`, 'utf8');
      }
      const db2 = openPipelineDb(dbPath);
      const { sessionId: newSessionId } = getOrCreateSession(db2, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db2, newSessionId, newComponents);
      storeScannedFiles(db2, newSessionId, newComponents.map((c) => c.source));
      const sid = createStep(db2, newSessionId, 'analyze extract', { project: projectDir });
      updateStep(db2, sid, 'complete', { sessionId: newSessionId });
      db2.close();
      return { sessionId: newSessionId };
    },
    /**
     * Seed a `current-review-state.json` snapshot with all components marked
     * accepted, so `generate components` will pick them up without first
     * running select.
     */
    async seedAcceptedSnapshot() {
      const dir = join(artifactsDir, sessionId);
      await mkdir(dir, { recursive: true });
      const snapshot = {
        sessionId,
        components: components.map((c) => ({
          name: c.name,
          status: 'accepted',
          originalProposal: c,
        })),
      };
      await writeFile(join(dir, 'current-review-state.json'), JSON.stringify(snapshot), 'utf8');
      await appendFile(join(dir, 'events.jsonl'), '', 'utf8');
    },
    cleanup: async () => {
      await rm(dbDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
      await rm(artifactsDir, { recursive: true, force: true });
    },
  };
}

export type CacheRow = {
  input_hash: string;
  entity_type: string;
  entity_id: string;
  source_session_id: string;
  prompt_hash: string;
};

export function readGenerationCache(dbPath: string): CacheRow[] {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare(
        'SELECT input_hash, entity_type, entity_id, source_session_id, prompt_hash FROM generation_cache ORDER BY entity_type, entity_id',
      )
      .all() as CacheRow[];
  } finally {
    db.close();
  }
}

export function readSelectCache(dbPath: string): Array<{
  component_hash: string;
  prompt_hash: string;
  cli_version: string;
  decision: string;
  reason: string | null;
}> {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare(
        'SELECT component_hash, prompt_hash, cli_version, decision, reason FROM select_cache ORDER BY component_hash',
      )
      .all() as Array<{
      component_hash: string;
      prompt_hash: string;
      cli_version: string;
      decision: string;
      reason: string | null;
    }>;
  } finally {
    db.close();
  }
}

export function readExtractCache(dbPath: string): Array<{
  file_path: string;
  file_hash: string;
  cli_version: string;
}> {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare('SELECT file_path, file_hash, cli_version FROM extract_cache ORDER BY file_path')
      .all() as Array<{ file_path: string; file_hash: string; cli_version: string }>;
  } finally {
    db.close();
  }
}

export function corruptSelectCacheCliVersion(dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  try {
    const r = db.prepare("UPDATE select_cache SET cli_version = 'corrupted-version-xyz'").run() as {
      changes: number;
    };
    return r.changes;
  } finally {
    db.close();
  }
}

export const SAMPLE_TWO_COMPONENTS: RawComponentDefinition[] = [
  {
    name: 'Button',
    source: 'src/Button.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true }],
    slots: [],
  },
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [{ name: 'title', type: 'string', required: true }],
    slots: [{ name: 'children', isDefault: true }],
  },
];

export function baseEnv(
  fix: { dbPath: string; artifactsDir: string },
  agent: { env(): Record<string, string> },
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    ...process.env,
    EDS_PIPELINE_DB_PATH: fix.dbPath,
    EDS_REVIEW_ARTIFACTS_DIR: fix.artifactsDir,
    NODE_NO_WARNINGS: '1',
    ...agent.env(),
    ...extra,
  };
}

export function bumpCliVersionRow(dbPath: string): void {
  // Force-corrupt the cli_version of any existing select_cache rows so the
  // next lookupSelectCache misses; used to guard the cli_version invariant.
  corruptSelectCacheCliVersion(dbPath);
}

// Re-export resolve so test files don't all need their own import.
export { resolve as resolvePath };
