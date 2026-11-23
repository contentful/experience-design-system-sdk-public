import { spawn } from 'node:child_process';
import { appendFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { constants } from 'node:os';
import { sampleProcessTree } from './processes.js';
import { writeProfileReport } from './resource-report.js';

import type {
  ProfiledImportResult,
  ResourceProfileManifest,
  ResourceProfileRecord,
  RunProfiledImportOptions,
} from './resource-profile-types.js';

export async function runProfiledImport({
  entryPoint,
  importArgs,
  directory,
  sampleIntervalMs = 1000,
  stdio = 'inherit',
  renderReport,
}: RunProfiledImportOptions): Promise<ProfiledImportResult> {
  directory = resolve(directory);
  const cpuDirectory = join(directory, 'cpu');
  const cpuIntervalUs = 10000;
  let profiled = true;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await readdir(directory)).length > 0) throw new Error('Profile directory is not empty.');
    await mkdir(cpuDirectory, { mode: 0o700 });
  } catch {
    profiled = false;
    if (stdio !== 'ignore') process.stderr.write('Profiling output unavailable; continuing import.\n');
  }
  const env = { ...process.env };
  if (profiled) {
    env.EDS_IMPORT_PROFILE_DIR = directory;
    env.NODE_OPTIONS = [
      env.NODE_OPTIONS,
      '--cpu-prof',
      `--cpu-prof-dir=${JSON.stringify(cpuDirectory)}`,
      `--cpu-prof-interval=${cpuIntervalUs}`,
    ]
      .filter(Boolean)
      .join(' ');
    if (stdio !== 'ignore') process.stderr.write(`Import profiling: ${directory}\n`);
  }
  const started = performance.now();
  const startedAtMs = performance.timeOrigin + started;
  const child = spawn(process.execPath, [entryPoint, 'import', ...importArgs], { stdio, env });
  const controller = new AbortController();
  const knownPids = new Set<number>();
  let receivedSignal: NodeJS.Signals | null = null;
  const handlers = new Map<NodeJS.Signals, () => void>(
    (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => [
      signal,
      () => {
        receivedSignal ??= signal;
        if (signal !== 'SIGINT' || !process.stdin.isTTY) child.kill(signal);
      },
    ]),
  );
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const manifest: ResourceProfileManifest = {
    schemaVersion: 1,
    rootPid: child.pid ?? null,
    startedAtMs,
    platform: process.platform,
    nodeVersion: process.version,
    sampleIntervalMs,
    cpuIntervalUs,
  };
  const writeManifest = async () => {
    if (!profiled) return;
    try {
      await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    } catch {}
  };
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
    child.once('error', () => resolveExit({ code: 1, signal: null }));
  });
  await writeManifest();
  const sampling = (async () => {
    const rootPid = child.pid;
    if (!profiled || !rootPid) return;
    while (!controller.signal.aborted) {
      const sampleStart = performance.now();
      let record: ResourceProfileRecord;
      try {
        const processes = await sampleProcessTree(rootPid, knownPids, controller.signal);
        record = { type: 'sample', timestampMs: performance.timeOrigin + sampleStart, processes };
      } catch {
        if (controller.signal.aborted) break;
        record = { type: 'sample-error', timestampMs: performance.timeOrigin + sampleStart };
      }
      try {
        await appendFile(join(directory, 'resources.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      } catch {
        break;
      }
      try {
        await delay(Math.max(0, sampleIntervalMs - (performance.now() - sampleStart)), undefined, {
          signal: controller.signal,
        });
      } catch {
        break;
      }
    }
  })();
  let outcome: { code: number | null; signal: NodeJS.Signals | null };
  try {
    outcome = await exit;
    controller.abort();
    await sampling;
    manifest.endedAtMs = performance.timeOrigin + performance.now();
    manifest.exitCode = outcome.code ?? 128 + (outcome.signal ? (constants.signals[outcome.signal] ?? 0) : 0);
    manifest.signal = outcome.signal ?? receivedSignal;
    await writeManifest();
    if (profiled) {
      try {
        await writeProfileReport(directory, renderReport);
        if (stdio !== 'ignore') process.stderr.write(`\nImport profile: ${join(directory, 'summary.md')}\n`);
      } catch {
        if (stdio !== 'ignore') process.stderr.write('\nProfile report unavailable; retained raw measurements.\n');
      }
    }
    return { exitCode: manifest.exitCode, signal: manifest.signal, directory, profiled };
  } finally {
    controller.abort();
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}
