import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import {
  importProfileDirectory,
  startImportProfileSpan,
  type ImportProfileAttributes,
  type ImportProfileStatus,
  type ImportWorkMetric,
  type ImportWorkMeasurements,
} from './import-profile.js';

export class ImportWorkTiming {
  readonly work: ImportWorkMeasurements = {};
  private readonly started = performance.now();
  private readonly span;
  private measuredMs = 0;
  constructor(name: string, attributes?: ImportProfileAttributes) {
    this.span = startImportProfileSpan(name, attributes);
  }
  measure<T>(metric: ImportWorkMetric, action: () => T): T {
    const started = performance.now();
    const nestedBefore = this.measuredMs;
    try {
      return action();
    } finally {
      const elapsed = Math.max(0, performance.now() - started - (this.measuredMs - nestedBefore));
      this.count(metric, elapsed);
      this.measuredMs += elapsed;
    }
  }
  count(metric: ImportWorkMetric, amount = 1): void {
    this.work[metric] = (this.work[metric] ?? 0) + amount;
  }
  end(status: ImportProfileStatus = 'success'): void {
    this.work.otherMs = Math.max(0, performance.now() - this.started - this.measuredMs);
    this.span.end(status, this.work);
  }
}
export function startImportWorkTiming(
  name: string,
  attributes?: ImportProfileAttributes,
): ImportWorkTiming | undefined {
  return importProfileDirectory() ? new ImportWorkTiming(name, attributes) : undefined;
}

const activeWork = new AsyncLocalStorage<ImportWorkTiming>();
export function withImportWorkTiming<T>(timing: ImportWorkTiming, action: () => T): T {
  return activeWork.run(timing, action);
}
export function currentImportWorkTiming(): ImportWorkTiming | undefined {
  return activeWork.getStore();
}
