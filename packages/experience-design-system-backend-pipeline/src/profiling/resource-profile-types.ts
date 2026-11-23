import type { StdioOptions } from 'node:child_process';

export interface ProcessResourceRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  cpuTotalMs: number;
  command: string;
}

export interface ResourceProfileSample {
  type: 'sample';
  timestampMs: number;
  processes: Array<
    Omit<ProcessResourceRow, 'ppid' | 'command'> & Partial<Pick<ProcessResourceRow, 'ppid' | 'command'>>
  >;
}

export type ResourceProfileRecord = ResourceProfileSample | { type: 'sample-error'; timestampMs: number };

export interface ResourceProfileManifest {
  schemaVersion?: number;
  rootPid?: number | null;
  startedAtMs: number;
  endedAtMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  platform?: string;
  nodeVersion?: string;
  sampleIntervalMs?: number;
  cpuIntervalUs?: number;
}

export interface ResourceProfileMemory {
  rssBytes?: number;
  heapUsedBytes?: number;
  heapTotalBytes?: number;
  heapLimitBytes?: number;
  externalBytes?: number;
  arrayBufferBytes?: number;
}

interface ResourceProfileSpanObservation {
  id: string;
  timestampMs: number;
  memory?: ResourceProfileMemory;
  memoryScopes?: Record<string, string>;
}

export interface ResourceProfileSpanStart extends ResourceProfileSpanObservation {
  type: 'span-start';
  name: string;
  pid: number;
  threadId: number;
  attributes?: Record<string, unknown>;
}

export interface ResourceProfileSpanEnd extends ResourceProfileSpanObservation {
  type: 'span-end';
  wallMs?: number;
  status?: string;
  threadCpuMs?: number | null;
  processCpuMs?: number | null;
  peakThreadMemory?: ResourceProfileMemory;
  boundaryMemoryDelta?: ResourceProfileMemory;
  sampling?: { intervalMs: number; periodicSamples: number; failures: number };
}

export type ResourceProfileSpanEvent = ResourceProfileSpanStart | ResourceProfileSpanEnd;

export interface ProfileProcessSummary {
  pid: number;
  command: string | undefined;
  role: 'unknown' | 'root' | 'child';
  observedCpuMs: number;
  lastCpuMs: number;
  sampledPeakRssBytes: number;
}

export interface ResourceProfileResources {
  sampleCount: number;
  processCount: number;
  sampledPeakTreeRssBytes: number | null;
  sampledPeakRootRssBytes: number | null;
  sampledPeakChildRssBytes: number | null;
  observedCpuMs: number | null;
  processes: ProfileProcessSummary[];
}

export interface ResourceProfileSpanSummary {
  id: string;
  name: string;
  attributes: Record<string, unknown> | undefined;
  pid: number;
  threadId: number;
  startedAtMs: number;
  endedAtMs: number;
  wallMs: number;
  status: string;
  threadCpuMs: number | null;
  processCpuMs: number | null;
  startMemory: ResourceProfileMemory | null;
  endMemory: ResourceProfileMemory | null;
  memoryScopes: Record<string, string> | null;
  peakThreadMemory: ResourceProfileMemory | null;
  boundaryMemoryDelta: ResourceProfileMemory | null;
  sampling: ResourceProfileSpanEnd['sampling'] | null;
}

export interface ResourceProfileSummary {
  schemaVersion: 1;
  startedAtMs: number;
  endedAtMs: number;
  wallMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sampleIntervalMs: number | undefined;
  cpuIntervalUs: number | undefined;
  resources: ResourceProfileResources;
  samplingFailures: number;
  spans: ResourceProfileSpanSummary[];
  malformedRecords?: number;
}

export type ProfileReportRenderer = (summary: ResourceProfileSummary) => string;

export interface RunProfiledImportOptions {
  entryPoint: string;
  importArgs: string[];
  directory: string;
  sampleIntervalMs?: number;
  stdio?: StdioOptions;
  renderReport: ProfileReportRenderer;
}

export interface ProfiledImportResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  directory: string;
  profiled: boolean;
}
