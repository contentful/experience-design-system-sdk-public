import type { binaryExists, pathExists, runSpawn } from '../../lib/shell.js';

export type PrerequisiteEventKind = 'success' | 'failure' | 'warning' | 'info';

export interface PrerequisiteEvent {
  kind: PrerequisiteEventKind;
  message: string;
}

/**
 * What the prerequisite checks need from the outside world.
 *
 * Unlike the other steps, this one is a sequential process rather than a form —
 * it checks Node, may offer to install a version manager, checks pnpm, may offer
 * corepack or npm, then installs and builds. Those mid-flow confirmations mean it
 * keeps an imperative shape, so it takes `confirm` and `emit` rather than
 * rendering each question itself.
 */
export interface PrerequisiteDeps {
  nodeVersion: string;
  homeDir: string;
  binaryExists: typeof binaryExists;
  pathExists: typeof pathExists;
  run: typeof runSpawn;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  emit(event: PrerequisiteEvent): void;
}

export interface PrerequisiteResult {
  passed: boolean;
}

export interface PrerequisitesOutcome {
  node: PrerequisiteResult & { restartRequired?: boolean };
  pnpm?: PrerequisiteResult;
  build?: PrerequisiteResult;
}

export function emit(deps: PrerequisiteDeps, kind: PrerequisiteEventKind, message: string): void {
  deps.emit({ kind, message });
}
