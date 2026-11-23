import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProcessRows, selectProcessTree } from '../../src/profiling/processes.js';
import { runProfiledImport } from '../../src/profiling/profiled-import.js';
import { summarizeProfile, writeProfileReport } from '../../src/profiling/resource-report.js';
import type { ResourceProfileRecord, ResourceProfileSpanEvent } from '../../src/profiling/resource-profile-types.js';

const builtLauncher = new URL('../../dist/src/profiling/profiled-import.js', import.meta.url);
const manifest = { startedAtMs: 0, endedAtMs: 100, rootPid: 10, sampleIntervalMs: 100, cpuIntervalUs: 10000 };
const records: ResourceProfileRecord[] = [
  {
    type: 'sample',
    timestampMs: 10,
    processes: [
      { pid: 10, command: 'node', rssBytes: 1000, cpuTotalMs: 50 },
      { pid: 10, command: 'node', rssBytes: 1000, cpuTotalMs: 50 },
      { pid: 11, command: 'helper', rssBytes: 400, cpuTotalMs: 10 },
    ],
  },
  {
    type: 'sample',
    timestampMs: 50,
    processes: [
      { pid: 10, command: 'node', rssBytes: 100, cpuTotalMs: 80 },
      { pid: 11, command: 'helper', rssBytes: 900, cpuTotalMs: 5 },
    ],
  },
  {
    type: 'sample',
    timestampMs: 70,
    processes: [
      { pid: 10, command: 'node', rssBytes: 300, cpuTotalMs: 90 },
      { pid: 11, command: 'helper', rssBytes: 100, cpuTotalMs: 20 },
    ],
  },
  { type: 'sample-error', timestampMs: 90 },
];
const events: ResourceProfileSpanEvent[] = [
  {
    type: 'span-start',
    id: 'work',
    name: 'work',
    pid: 10,
    threadId: 1,
    timestampMs: 5,
    attributes: { task: 'generic' },
  },
  { type: 'span-start', id: 'screen', name: 'screen', pid: 10, threadId: 0, timestampMs: 20 },
  { type: 'span-end', id: 'work', timestampMs: 65, wallMs: 60, status: 'success', threadCpuMs: 15, processCpuMs: 25 },
];
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'backend-resource-profile-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('backend resource profiling', () => {
  it('parses supported process clocks and rejects malformed rows without recording arguments', () => {
    const rows = parseProcessRows(
      '10 1 100 0:01.25 /usr/bin/node\n11 10 200 00:00:02 /usr/bin/helper\n12 11 300 1-02:03:04 native-helper\n99 1 400 bad-clock unrelated\nmalformed\n',
    );
    expect(rows).toEqual([
      { pid: 10, ppid: 1, rssBytes: 102400, cpuTotalMs: 1250, command: 'node' },
      { pid: 11, ppid: 10, rssBytes: 204800, cpuTotalMs: 2000, command: 'helper' },
      { pid: 12, ppid: 11, rssBytes: 307200, cpuTotalMs: 93784000, command: 'native-helper' },
    ]);
    expect(selectProcessTree(rows, 10).map((row) => row.pid)).toEqual([10, 11, 12]);
    expect(
      selectProcessTree(
        [
          { pid: 11, ppid: 1 },
          { pid: 12, ppid: 11 },
          { pid: 99, ppid: 1 },
        ],
        10,
        new Set([11]),
      ),
    ).toEqual([
      { pid: 11, ppid: 1 },
      { pid: 12, ppid: 11 },
    ]);
    expect(parseProcessRows('')).toEqual([]);
  });

  it('preserves concurrent root/child peaks, CPU deltas, overlap and unfinished timing', () => {
    const summary = summarizeProfile(manifest, records, events);
    expect(summary.resources).toEqual({
      sampleCount: 3,
      processCount: 2,
      sampledPeakTreeRssBytes: 1400,
      sampledPeakRootRssBytes: 1000,
      sampledPeakChildRssBytes: 900,
      observedCpuMs: 115,
      processes: [
        { pid: 10, command: 'node', role: 'root', observedCpuMs: 90, lastCpuMs: 90, sampledPeakRssBytes: 1000 },
        { pid: 11, command: 'helper', role: 'child', observedCpuMs: 25, lastCpuMs: 20, sampledPeakRssBytes: 900 },
      ],
    });
    expect(summary).toMatchObject({ wallMs: 100, samplingFailures: 1 });
    expect(summary.spans.map((span) => [span.name, span.wallMs, span.status])).toEqual([
      ['screen', 80, 'unfinished'],
      ['work', 60, 'success'],
    ]);
    expect(summary.spans[0]).toMatchObject({ threadCpuMs: null, processCpuMs: null, peakThreadMemory: null });
    expect(summarizeProfile({ startedAtMs: 0 }, records, events).endedAtMs).toBe(90);
  });

  it('reconstructs exact reports from raw receipts while preserving malformed-line accounting', async () => {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'resources.jsonl'), records.map((row) => JSON.stringify(row)).join('\n') + '\n{\n');
    await writeFile(join(directory, 'spans.10.1.jsonl'), events.map((row) => JSON.stringify(row)).join('\n') + '\n{\n');
    const render = (summary: ReturnType<typeof summarizeProfile>) => `generic report: ${summary.wallMs}`;
    const summary = await writeProfileReport(directory, render);
    expect(summary).toEqual({ ...summarizeProfile(manifest, records, events), malformedRecords: 2 });
    expect(JSON.parse(await readFile(join(directory, 'summary.json'), 'utf8'))).toEqual(
      JSON.parse(JSON.stringify(summary)),
    );
    expect(await readFile(join(directory, 'summary.md'), 'utf8')).toBe('generic report: 100');
    const trace = JSON.parse(await readFile(join(directory, 'trace.json'), 'utf8'));
    expect(trace).toMatchObject({ displayTimeUnit: 'ms' });
    expect(trace.traceEvents).toHaveLength(9);
    expect(trace.traceEvents[0]).toMatchObject({ name: 'screen', cat: 'screen', ph: 'X', ts: 20000, dur: 80000 });
    expect(trace.traceEvents[2]).toMatchObject({ name: 'Process resources', ph: 'C', pid: 10, ts: 10000 });
    expect((await stat(join(directory, 'summary.json'))).mode & 0o777).toBe(0o600);
  });

  it('keeps absent sampling unavailable and refuses missing manifests before output writes', async () => {
    await expect(writeProfileReport(directory, () => '')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toEqual([]);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    const summary = await writeProfileReport(directory, () => 'empty');
    expect(summary.resources).toMatchObject({
      sampleCount: 0,
      processCount: 0,
      sampledPeakTreeRssBytes: null,
      observedCpuMs: null,
    });
    expect(summary.malformedRecords).toBe(0);
  });

  it('samples a blocked generic root and real child, forwards inputs, and settles sampler/listeners', async () => {
    const entryPoint = join(directory, 'workload.mjs');
    const args = join(directory, 'args.json');
    await writeFile(
      entryPoint,
      `import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(args)}, JSON.stringify(process.argv.slice(2)));
      spawn(process.execPath, ['-e', 'setTimeout(() => {}, 850)'], { stdio: 'ignore' });
      const until = Date.now() + 650; while (Date.now() < until) {}`,
    );
    const output = join(directory, 'profile');
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const listeners = signals.map((signal) => process.listenerCount(signal));
    const result = await runProfiledImport({
      entryPoint,
      importArgs: ['--example-option', 'generic-value'],
      directory: output,
      sampleIntervalMs: 100,
      stdio: 'ignore',
      renderReport: () => 'generic report',
    });
    expect(result).toMatchObject({ exitCode: 0, signal: null, profiled: true });
    expect(JSON.parse(await readFile(args, 'utf8'))).toEqual(['import', '--example-option', 'generic-value']);
    const summary = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
    expect(summary.resources.sampleCount).toBeGreaterThan(0);
    expect(summary.resources.processCount).toBeGreaterThanOrEqual(2);
    expect(summary.resources.sampledPeakChildRssBytes).toBeGreaterThan(0);
    expect(
      (await readdir(join(output, 'cpu'))).filter((name) => name.endsWith('.cpuprofile')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).not.toContain('generic-value');
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual(listeners);
    const raw = await readFile(join(output, 'resources.jsonl'), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await readFile(join(output, 'resources.jsonl'), 'utf8')).toBe(raw);
  });

  it('preserves nonzero exits and existing receipts when output is reused', async () => {
    const entryPoint = join(directory, 'failure.mjs');
    await writeFile(entryPoint, 'process.exit(7);');
    const output = join(directory, 'profile');
    await mkdir(output);
    await writeFile(join(output, 'manifest.json'), 'existing receipt');
    expect(
      await runProfiledImport({
        entryPoint,
        importArgs: [],
        directory: output,
        stdio: 'ignore',
        renderReport: () => '',
      }),
    ).toMatchObject({ exitCode: 7, profiled: false });
    expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe('existing receipt');
  });

  it('forwards owned cancellation, joins the launcher and writes the terminal report', async () => {
    const entryPoint = join(directory, 'cancel.mjs');
    const ready = join(directory, 'ready');
    const output = join(directory, 'profile');
    await writeFile(
      entryPoint,
      `import { writeFileSync } from 'node:fs';
      process.on('SIGTERM', () => process.exit(143));
      writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 100);`,
    );
    const harness = join(directory, 'harness.mjs');
    await writeFile(
      harness,
      `import { runProfiledImport } from ${JSON.stringify(builtLauncher.href)};
      const result = await runProfiledImport({ entryPoint: ${JSON.stringify(entryPoint)}, importArgs: [], directory: ${JSON.stringify(output)}, sampleIntervalMs: 100, stdio: 'ignore', renderReport: () => 'cancelled' }); process.exitCode = result.exitCode;`,
    );
    const child = spawn(process.execPath, [harness], { stdio: 'ignore' });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    try {
      for (let i = 0; i < 100 && !(await readdir(directory)).includes('ready'); i++)
        await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await readdir(directory)).toContain('ready');
      child.kill('SIGTERM');
      expect(await closed).toEqual({ code: 143, signal: null });
      expect(JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))).toMatchObject({
        exitCode: 143,
        signal: 'SIGTERM',
      });
      expect(await readFile(join(output, 'summary.md'), 'utf8')).toBe('cancelled');
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  });
});
