import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';

export class BoundedResidentCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number; usedAt: number }>();
  private bytes = 0;
  private nextPressureCheck = 0;
  private pressured = false;
  constructor(
    private readonly options: {
      maxBytes: number;
      maxEntries: number;
      idleMs: number;
      now?: () => number;
      underPressure?: () => boolean;
      onEvict?: () => void;
    },
  ) {
    if (
      !Number.isSafeInteger(options.maxBytes) ||
      options.maxBytes < 1 ||
      !Number.isSafeInteger(options.maxEntries) ||
      options.maxEntries < 1 ||
      !Number.isFinite(options.idleMs) ||
      options.idleMs <= 0
    )
      throw new Error('Invalid resident cache limits');
  }
  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
    this.options.onEvict?.();
  }
  private maintain(): number {
    const now = this.options.now?.() ?? performance.now();
    if (now >= this.nextPressureCheck) {
      this.nextPressureCheck = now + 250;
      this.pressured =
        this.options.underPressure?.() ?? process.memoryUsage().heapUsed >= getHeapStatistics().heap_size_limit * 0.8;
    }
    for (const [key, entry] of this.entries) {
      if (!this.pressured && now - entry.usedAt < this.options.idleMs) break;
      this.evict(key);
    }
    return now;
  }
  get(key: string): T | undefined {
    const now = this.maintain(),
      entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    entry.usedAt = now;
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key: string, value: T, bytes: number): void {
    const now = this.maintain();
    this.evict(key);
    if (this.pressured || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.options.maxBytes) return;
    while (this.entries.size >= this.options.maxEntries || this.bytes + bytes > this.options.maxBytes)
      this.evict(this.entries.keys().next().value!);
    this.entries.set(key, { value, bytes, usedAt: now });
    this.bytes += bytes;
  }
  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}
