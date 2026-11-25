import type { ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { AgentName } from '../types/agent-name.js';
import type { AgentRuntimeMeasurements } from '../types/agent-run.js';
import { isNativeTransportEvent } from './agent-native-usage.js';
import { createUtf8LineBuffer } from './utf8-line-buffer.js';

export function createAgentRuntimeRecorder(agent: AgentName, model: string | undefined, structured: boolean) {
  const started = performance.now();
  const lines = createUtf8LineBuffer();
  let launch: number | undefined;
  let lastStdoutAt: number | undefined;
  let detach: (() => void) | undefined;
  const measurements: AgentRuntimeMeasurements = {
    transport: 'local-cli',
    agent,
    ...(model ? { model } : {}),
    invocationElapsedMs: 0,
  };
  const observeLine = (line: string, at: number) => {
    if (!structured || measurements.firstEventMs !== undefined || launch === undefined || !line.trim()) return;
    try {
      if (isNativeTransportEvent(agent, JSON.parse(line))) measurements.firstEventMs = at - launch;
    } catch {}
  };
  const observeBytes = (chunk: Buffer | string, stdout: boolean) => {
    if (launch === undefined || chunk.length === 0) return;
    const at = performance.now();
    measurements.firstOutputMs ??= at - launch;
    if (!stdout) return;
    measurements.firstStdoutMs ??= at - launch;
    lastStdoutAt = at;
    if (!structured || measurements.firstEventMs !== undefined) return;
    for (const line of lines.push(chunk)) observeLine(line, at);
  };
  return {
    launch() {
      launch = performance.now();
      measurements.launchAfterMs = launch - started;
    },
    attach(child: ChildProcess) {
      const onSpawn = () => {
        if (launch !== undefined) measurements.startupMs ??= performance.now() - launch;
      };
      const onStdout = (chunk: Buffer | string) => observeBytes(chunk, true);
      const onStderr = (chunk: Buffer | string) => observeBytes(chunk, false);
      child.once('spawn', onSpawn);
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      detach = () => {
        child.removeListener('spawn', onSpawn);
        child.stdout?.removeListener('data', onStdout);
        child.stderr?.removeListener('data', onStderr);
      };
    },
    processEnded() {
      if (launch !== undefined) measurements.processElapsedMs = performance.now() - launch;
      const rest = lines.end();
      if (lastStdoutAt !== undefined) observeLine(rest, lastStdoutAt);
      detach?.();
    },
    finish(): AgentRuntimeMeasurements {
      measurements.invocationElapsedMs = performance.now() - started;
      return { ...measurements };
    },
  };
}
