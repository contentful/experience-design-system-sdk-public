import type { AgentName } from '@contentful/experience-design-system-generation';
import type { ExperiencesCredentials } from '../../credentials-store.js';
import type { ShellCommandResult } from './shell.js';

export type SetupActionEventKind = 'success' | 'failure' | 'warning' | 'info' | 'help';

export interface SetupActionEvent {
  kind: SetupActionEventKind;
  message: string;
}

export interface SetupChoice {
  label: string;
  description?: string;
}

/**
 * Everything a setup step needs from the outside world. Prompts and output are
 * supplied by whatever renders the step — the Ink screen in production, stubs in
 * tests — so the steps hold the business rules and none of the presentation.
 */
export interface SetupActionDependencies {
  nodeVersion: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** Resolves the chosen index, or `undefined` when the operator skips. */
  choose(question: string, options: readonly SetupChoice[]): Promise<number | undefined>;
  write(event: SetupActionEvent): void;
  binaryExists(binary: string): Promise<boolean>;
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<ShellCommandResult>;
  pathExists(path: string): Promise<boolean>;
  profileContains(profilePath: string, value: string): Promise<boolean>;
  appendToProfile(profilePath: string, lines: string): Promise<void>;
  readCredentials(): Promise<ExperiencesCredentials>;
  writeCredentials(credentials: ExperiencesCredentials): Promise<void>;
  credentialsPath(): string;
}

export interface SetupCheckResult {
  passed: boolean;
}

export interface PrerequisitesSetupResult {
  node: SetupCheckResult & { restartRequired?: boolean };
  pnpm?: SetupCheckResult;
  build?: SetupCheckResult;
}

export interface AgentSetupResult {
  agent: AgentName | undefined;
  agentModel: string | undefined;
  passed: boolean;
}

export function emit(dependencies: SetupActionDependencies, kind: SetupActionEventKind, message: string): void {
  dependencies.write({ kind, message });
}
