import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';

import type { ProcessResourceRow } from './resource-profile-types.js';

const execute = promisify(execFile);

function cpuMilliseconds(clock: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(clock);
  if (!match) return null;
  const [, days = '0', hours = '0', minutes, seconds] = match;
  return Math.round((Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

export function parseProcessRows(output: string): ProcessResourceRow[] {
  return output.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    const [, pid, ppid, rss, time, command] = match;
    const cpuTotalMs = cpuMilliseconds(time);
    if (cpuTotalMs === null) return [];
    return [
      { pid: Number(pid), ppid: Number(ppid), rssBytes: Number(rss) * 1024, cpuTotalMs, command: basename(command) },
    ];
  });
}

export function selectProcessTree<T extends { pid: number; ppid: number }>(
  rows: T[],
  rootPid: number,
  knownPids = new Set<number>(),
): T[] {
  const included = new Set([rootPid, ...knownPids]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.ppid) && !included.has(row.pid)) {
        included.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => included.has(row.pid));
}

export async function sampleProcessTree(
  rootPid: number,
  knownPids: Set<number>,
  signal?: AbortSignal,
): Promise<ProcessResourceRow[]> {
  const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 8 * 1024 * 1024,
    signal,
  });
  const rows = parseProcessRows(stdout);
  const presentPids = new Set(rows.map((row) => row.pid));
  for (const pid of knownPids) if (!presentPids.has(pid)) knownPids.delete(pid);
  const tree = selectProcessTree(rows, rootPid, knownPids);
  for (const row of tree) knownPids.add(row.pid);
  return tree;
}
