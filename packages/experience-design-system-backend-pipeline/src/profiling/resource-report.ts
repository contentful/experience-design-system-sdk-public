import { createReadStream } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ProfileProcessSummary,
  ProfileReportRenderer,
  ResourceProfileManifest,
  ResourceProfileRecord,
  ResourceProfileResources,
  ResourceProfileSample,
  ResourceProfileSpanEvent,
  ResourceProfileSummary,
} from './resource-profile-types.js';

function summarizeResources(samples: ResourceProfileSample[], rootPid?: number | null): ResourceProfileResources {
  const processes = new Map<number, ProfileProcessSummary>();
  let sampledPeakTreeRssBytes = 0;
  let sampledPeakRootRssBytes: number | null = null;
  let sampledPeakChildRssBytes: number | null = null;
  for (const sample of samples) {
    const unique = new Map(sample.processes.map((row) => [row.pid, row]));
    if (typeof rootPid === 'number' && unique.size) {
      const root = unique.get(rootPid);
      if (root) sampledPeakRootRssBytes = Math.max(sampledPeakRootRssBytes ?? 0, root.rssBytes);
      sampledPeakChildRssBytes = Math.max(
        sampledPeakChildRssBytes ?? 0,
        [...unique.values()].reduce((sum, row) => sum + (row.pid === rootPid ? 0 : row.rssBytes), 0),
      );
    }
    sampledPeakTreeRssBytes = Math.max(
      sampledPeakTreeRssBytes,
      [...unique.values()].reduce((sum, row) => sum + row.rssBytes, 0),
    );
    for (const row of unique.values()) {
      const previous = processes.get(row.pid);
      processes.set(row.pid, {
        pid: row.pid,
        command: row.command,
        role: typeof rootPid !== 'number' ? 'unknown' : row.pid === rootPid ? 'root' : 'child',
        observedCpuMs: (previous?.observedCpuMs ?? 0) + Math.max(0, row.cpuTotalMs - (previous?.lastCpuMs ?? 0)),
        lastCpuMs: row.cpuTotalMs,
        sampledPeakRssBytes: Math.max(previous?.sampledPeakRssBytes ?? 0, row.rssBytes),
      });
    }
  }
  return {
    sampleCount: samples.length,
    processCount: processes.size,
    sampledPeakTreeRssBytes: processes.size ? sampledPeakTreeRssBytes : null,
    sampledPeakRootRssBytes,
    sampledPeakChildRssBytes,
    observedCpuMs: processes.size ? [...processes.values()].reduce((sum, row) => sum + row.observedCpuMs, 0) : null,
    processes: [...processes.values()].sort((a, b) => b.observedCpuMs - a.observedCpuMs),
  };
}

export function summarizeProfile(
  manifest: ResourceProfileManifest,
  records: ResourceProfileRecord[],
  events: ResourceProfileSpanEvent[],
): ResourceProfileSummary {
  const samples = records.filter((record) => record.type === 'sample');
  const finalTimestamp =
    manifest.endedAtMs ??
    [...records, ...events].reduce((latest, record) => Math.max(latest, record.timestampMs), manifest.startedAtMs);
  const endings = new Map(events.filter((event) => event.type === 'span-end').map((event) => [event.id, event]));
  const spans = events
    .filter((event) => event.type === 'span-start')
    .map((begin) => {
      const end = endings.get(begin.id);
      return {
        id: begin.id,
        name: begin.name,
        attributes: begin.attributes,
        pid: begin.pid,
        threadId: begin.threadId,
        startedAtMs: begin.timestampMs,
        endedAtMs: end?.timestampMs ?? finalTimestamp,
        wallMs: end?.wallMs ?? Math.max(0, finalTimestamp - begin.timestampMs),
        status: end?.status ?? 'unfinished',
        threadCpuMs: end?.threadCpuMs ?? null,
        processCpuMs: end?.processCpuMs ?? null,
        startMemory: begin.memory ?? null,
        endMemory: end?.memory ?? null,
        memoryScopes: begin.memoryScopes ?? null,
        peakThreadMemory: end?.peakThreadMemory ?? null,
        boundaryMemoryDelta: end?.boundaryMemoryDelta ?? null,
        sampling: end?.sampling ?? null,
      };
    })
    .sort((a, b) => b.wallMs - a.wallMs);
  return {
    schemaVersion: 1,
    startedAtMs: manifest.startedAtMs,
    endedAtMs: finalTimestamp,
    wallMs: Math.max(0, finalTimestamp - manifest.startedAtMs),
    exitCode: manifest.exitCode ?? null,
    signal: manifest.signal ?? null,
    sampleIntervalMs: manifest.sampleIntervalMs,
    cpuIntervalUs: manifest.cpuIntervalUs,
    resources: summarizeResources(samples, manifest.rootPid),
    samplingFailures: records.filter((record) => record.type === 'sample-error').length,
    spans,
  };
}

function traceEvents(summary: ResourceProfileSummary, records: ResourceProfileRecord[]) {
  return [
    ...summary.spans.map((span) => ({
      name: [span.name, span.attributes?.task, span.attributes?.stage].filter(Boolean).join(' · '),
      cat: span.name === 'screen' ? 'screen' : 'work',
      ph: 'X',
      pid: span.pid,
      tid: span.threadId,
      ts: (span.startedAtMs - summary.startedAtMs) * 1000,
      dur: span.wallMs * 1000,
      args: { ...span.attributes, status: span.status, threadCpuMs: span.threadCpuMs, processCpuMs: span.processCpuMs },
    })),
    ...records
      .filter((record) => record.type === 'sample')
      .flatMap((sample) =>
        sample.processes.map((row) => ({
          name: 'Process resources',
          ph: 'C',
          pid: row.pid,
          tid: 0,
          ts: (sample.timestampMs - summary.startedAtMs) * 1000,
          args: { rssMiB: row.rssBytes / 1024 / 1024, cpuSeconds: row.cpuTotalMs / 1000 },
        })),
      ),
  ];
}

async function readJsonLines<T>(path: string): Promise<{ values: T[]; malformed: number }> {
  const values: T[] = [];
  let malformed = 0;
  const parse = (line: string) => {
    if (!line.trim()) return;
    try {
      values.push(JSON.parse(line));
    } catch {
      malformed++;
    }
  };
  try {
    let pending = '';
    for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop()!;
      for (const line of lines) parse(line);
    }
    parse(pending);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { values, malformed };
}

export async function writeProfileReport(
  directory: string,
  renderReport: ProfileReportRenderer,
): Promise<ResourceProfileSummary> {
  const manifest: ResourceProfileManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const resources = await readJsonLines<ResourceProfileRecord>(join(directory, 'resources.jsonl'));
  const files = (await readdir(directory)).filter((name) => /^spans\.\d+\.\d+\.jsonl$/.test(name));
  const spanFiles = await Promise.all(
    files.map((name) => readJsonLines<ResourceProfileSpanEvent>(join(directory, name))),
  );
  const summary = summarizeProfile(
    manifest,
    resources.values,
    spanFiles.flatMap((file) => file.values),
  );
  summary.malformedRecords = resources.malformed + spanFiles.reduce((sum, file) => sum + file.malformed, 0);
  await writeFile(join(directory, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, 'summary.md'), renderReport(summary), { mode: 0o600 });
  await writeFile(
    join(directory, 'trace.json'),
    JSON.stringify({ traceEvents: traceEvents(summary, resources.values), displayTimeUnit: 'ms' }),
    { mode: 0o600 },
  );
  return summary;
}
