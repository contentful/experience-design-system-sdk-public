import { reportAgent } from './report-agent.js';
import { reportBuild } from './report-build.js';
import { reportDependencies } from './report-dependencies.js';
import { reportNode } from './report-node.js';
import { reportPnpm } from './report-pnpm.js';
import type { CheckOutcome } from './types/report.js';

export interface RunDoctorRequest {
  pkgRoot: string;
}

export interface RunDoctorResult {
  outcomes: CheckOutcome[];
  requiredFailed: number;
  totalFailed: number;
  allPassed: boolean;
}

export async function runDoctor(request: RunDoctorRequest): Promise<RunDoctorResult> {
  const { pkgRoot } = request;
  const outcomes: CheckOutcome[] = [];

  const node = await reportNode();
  outcomes.push(node);
  if (node.ok) {
    const pnpm = await reportPnpm(pkgRoot);
    outcomes.push(pnpm);
    if (pnpm.ok) {
      const deps = await reportDependencies(pkgRoot);
      outcomes.push(deps);
      if (deps.ok) {
        outcomes.push(await reportBuild(pkgRoot));
      }
    }
  }

  outcomes.push(await reportAgent());

  const failed = outcomes.filter((o) => !o.ok);
  const requiredFailed = failed.filter((o) => o.required).length;

  return {
    outcomes,
    requiredFailed,
    totalFailed: failed.length,
    allPassed: failed.length === 0,
  };
}
