import type { ExperiencesCredentials } from '../../../src/credentials-store.js';
import type { SetupActionDependencies } from '../../../src/setup/lib/types.js';

/**
 * A setup step's dependencies with every side effect stubbed. Defaults describe
 * a machine that is already set up — Node 24, pnpm present, empty credentials —
 * so each test overrides only the condition it exercises.
 */
export function createDependencies(overrides: Partial<SetupActionDependencies> = {}): SetupActionDependencies {
  let credentials: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };
  return {
    nodeVersion: '24.18.1',
    homeDir: '/home/tester',
    env: {},
    ask: async () => '',
    askSecret: async () => '',
    confirm: async () => true,
    choose: async () => 0,
    write: () => undefined,
    binaryExists: async (binary) => binary === 'pnpm',
    run: async () => ({ exitCode: 0, stdout: '10.0.0\n', stderr: '' }),
    pathExists: async () => false,
    profileContains: async () => false,
    appendToProfile: async () => undefined,
    readCredentials: async () => credentials,
    writeCredentials: async (next) => {
      credentials = next;
    },
    credentialsPath: () => '/home/tester/.config/experiences/credentials.json',
    ...overrides,
  };
}

/** An `ask` that yields the given answers in order, then empty strings. */
export function scripted(answers: string[]): (question: string) => Promise<string> {
  let index = 0;
  return async () => {
    const next = answers[index] ?? '';
    index += 1;
    return next;
  };
}
