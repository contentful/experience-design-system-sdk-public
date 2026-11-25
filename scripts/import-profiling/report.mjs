import { writeProfileReport as writeBackendProfileReport } from '../../packages/experience-design-system-backend-pipeline/dist/src/profiling/resource-report.js';
export { summarizeProfile } from '../../packages/experience-design-system-backend-pipeline/dist/src/profiling/resource-report.js';

const seconds = (ms) => (ms === null ? 'unavailable' : `${(ms / 1000).toFixed(2)}s`);
const MAX_TABLE_ROWS = 30;
const escapeCell = (text) => String(text).replace(/[\\|\r\n]/g, (character) => (character === '\\' ? '\\\\' : ' '));
const mib = (bytes) => (typeof bytes === 'number' ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : 'unavailable');

function memoryTable(spans) {
  return [
    '| Work | PID / thread | Start heap | End heap | Heap limit | End external | End array buffers |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...spans.slice(0, MAX_TABLE_ROWS).map((span) => {
      const label = [span.name, span.attributes?.task, span.attributes?.workerRole].filter(Boolean).join(' · ');
      return `| ${escapeCell(label)} | ${escapeCell(span.pid)} / ${escapeCell(span.threadId)} | ${mib(span.startMemory?.heapUsedBytes)} | ${mib(span.endMemory?.heapUsedBytes)} | ${mib(span.startMemory?.heapLimitBytes)} | ${mib(span.endMemory?.externalBytes)} | ${mib(span.endMemory?.arrayBufferBytes)} |`;
    }),
  ].join('\n');
}

function spanTable(spans) {
  return [
    '| Work | Status | Wall time | Thread CPU | Process CPU |',
    '| --- | --- | ---: | ---: | ---: |',
    ...spans.slice(0, MAX_TABLE_ROWS).map((span) => {
      const label = [
        span.name,
        span.attributes?.task,
        span.attributes?.stage,
        span.attributes?.component,
        span.attributes?.step,
        span.attributes?.attempt && `attempt ${span.attributes.attempt}`,
      ]
        .filter(Boolean)
        .join(' · ');
      return `| ${escapeCell(label)} | ${escapeCell(span.status)} | ${seconds(span.wallMs)} | ${seconds(span.threadCpuMs)} | ${seconds(span.processCpuMs)} |`;
    }),
  ].join('\n');
}

function peakMemoryTable(spans) {
  return [
    '| Work | PID / thread | Observed peak heap | Observed peak external | Heap boundary delta | Periodic samples / failures | Numeric counters |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...spans.slice(0, MAX_TABLE_ROWS).map((span) => {
      const counters = Object.entries(span.attributes ?? {})
        .filter(([, value]) => typeof value === 'number')
        .map(([key, value]) => `${key}=${value}`)
        .join(', ');
      const sampling = span.sampling ? `${span.sampling.periodicSamples} / ${span.sampling.failures}` : 'unavailable';
      return `| ${escapeCell(span.name)} | ${escapeCell(span.pid)} / ${escapeCell(span.threadId)} | ${mib(span.peakThreadMemory?.heapUsedBytes)} | ${mib(span.peakThreadMemory?.externalBytes)} | ${mib(span.boundaryMemoryDelta?.heapUsedBytes)} | ${escapeCell(sampling)} | ${escapeCell(counters)} |`;
    }),
  ].join('\n');
}

export function renderProfileReport(summary) {
  return [
    '# Import profile',
    '',
    `- Wall time: ${seconds(summary.wallMs)}`,
    `- Observed process-tree CPU: ${seconds(summary.resources.observedCpuMs)}`,
    `- Sampled process-tree RSS peak: ${mib(summary.resources.sampledPeakTreeRssBytes)}`,
    `- Sampled root-process RSS peak: ${mib(summary.resources.sampledPeakRootRssBytes)}; sampled concurrent child-process RSS peak: ${mib(summary.resources.sampledPeakChildRssBytes)}`,
    `- ${summary.resources.sampleCount} resource samples; ${summary.resources.processCount} distinct PIDs; ${summary.samplingFailures} sampling failures`,
    `- Exit code: ${summary.exitCode ?? 'unfinished'}; signal: ${summary.signal ?? 'none'}`,
    '',
    '## Longest work intervals',
    '',
    spanTable(summary.spans.filter((span) => span.name !== 'screen')),
    '',
    '## Time on screens (includes human interaction)',
    '',
    spanTable(summary.spans.filter((span) => span.name === 'screen')),
    '',
    '## Memory at work boundaries',
    '',
    memoryTable(summary.spans.filter((span) => span.name !== 'screen')),
    '',
    'Heap and external memory observations belong to the reporting worker thread; RSS belongs to the process. Array buffers are included in external memory and must not be added to it. Boundary observations are not transient heap peaks; unfinished work may have only a start observation. Legacy spans may lack limits or memory-scope metadata.',
    '',
    '## Observed thread memory peaks and boundary deltas',
    '',
    peakMemoryTable(summary.spans.filter((span) => span.name !== 'screen')),
    '',
    'Observed thread peaks include start/end boundaries and periodic observations while the isolate event loop can run. Zero periodic samples means boundary-only coverage. Synchronous work can hide transient peaks; unfinished or legacy spans have unavailable peaks. Per-field maxima can occur at different moments and must not be added. Sampling uses one timer per isolate, retains fixed-size maxima and writes no periodic event queue. Boundary deltas are not proof of retained memory after collection.',
    '',
    'Native allocations are included in process RSS; their separate size is unavailable. Worker heaps and external memory must not be subtracted from asynchronously sampled RSS to infer native allocation. Root and child peaks may occur at different moments; do not add them to estimate the process-tree peak.',
    '',
    'Durations are inclusive and can overlap; do not sum spans. Process CPU includes concurrent workers; thread CPU includes overlapping work on the same thread. Thread CPU is unavailable on unsupported runtimes. RSS is counted once per PID, including shared worker memory. Individual process peaks occur at different moments and must not be added.',
    '',
    'Sampling can miss short-lived processes and transient peaks. JavaScript CPU profiles in cpu/ cover Node processes and workers that inherited the profiling flags; native agents are covered by process-tree sampling. SIGKILL and abrupt native termination may leave CPU profiles unavailable. Profiling adds measurement overhead.',
    '',
    'Use trace.json in a local trace viewer for the timeline, summary.json for all spans, and resources.jsonl for raw measurements.',
    '',
  ].join('\n');
}

export function writeProfileReport(directory) {
  return writeBackendProfileReport(directory, renderProfileReport);
}
