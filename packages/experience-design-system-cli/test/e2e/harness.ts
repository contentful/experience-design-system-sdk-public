import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

// Renders the real app and drives it the way a user does. The app is not changed or mocked: the agent is a fake
// `claude` script (the pipeline already lets EDS_AGENT_BINARY_CLAUDE point at another binary) and Contentful is a local
// server whose address is typed in as the API host. Everything else is real, so the fixture is really extracted,
// composed, generated, saved and pushed.

type Key = 'enter' | 'escape' | 'up' | 'down' | 'tab' | 'backspace' | 'ctrl-d';

const KEY_BYTES: Record<Key, string> = {
  enter: '\r',
  escape: '\u001B',
  up: '\u001B[A',
  down: '\u001B[B',
  tab: '\t',
  backspace: '\u007F',
  'ctrl-d': '\u0004',
};

// Wide enough for the home screen, which refuses to show below 164 columns.
const COLUMNS = 200;
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]/g;
const CLEAR_SCREEN = '\x1b[H\x1b[0J';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
// The process events the app's debug store listens to, for its crash and exit handling.
const PROCESS_EVENTS = ['uncaughtException', 'unhandledRejection', 'SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const emitter: NodeJS.EventEmitter = process;

export interface ImportSession {
  /** The text on screen right now, with colours removed. */
  screen(): string;
  press(key: Key): Promise<void>;
  type(text: string): Promise<void>;
  /** Resolves when the text is on screen; fails with the last screen if it is not there in time. */
  waitForText(text: string | RegExp, timeoutMs?: number): Promise<void>;
  /** Ends the app and puts the process back as it was. Call it even when a scenario fails. */
  stop(): Promise<void>;
}

class FakeStdout extends EventEmitter {
  columns = COLUMNS;
  rows = 60;
  last = '';
  write = (frame: string): boolean => {
    this.last = frame;
    return true;
  };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private pending: string | null = null;
  write = (data: string): void => {
    this.pending = data;
    this.emit('readable');
    this.emit('data', data);
  };
  read = (): string | null => {
    const data = this.pending;
    this.pending = null;
    return data;
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Nothing in a scenario may reach the real internet (the home screen checks GitHub for a newer version). */
function blockOutsideNetwork(): void {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    // Only the network is blocked: data: and file: URLs are how some libraries load their own code.
    const outside = (url.protocol === 'http:' || url.protocol === 'https:') && !LOCAL_HOSTS.has(url.hostname);
    if (outside) return Promise.reject(new Error(`e2e: blocked request to ${url.hostname}`));
    return real(input, init);
  });
}

export async function startImport(): Promise<ImportSession> {
  // The debug store reads the settings when it is first imported, so every scenario loads a fresh copy of the app. ink
  // and react are loaded after the reset too, so the app and the renderer share one copy of react.
  vi.resetModules();
  // Only the listeners the app adds are taken off again: the test runner has its own on the same events.
  const listenersBefore = PROCESS_EVENTS.map((event) => new Set<unknown>(emitter.listeners(event)));
  blockOutsideNetwork();
  const writeToTerminal = process.stdout.write.bind(process.stdout);
  const quietWrite = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown, ...rest: unknown[]) =>
      chunk === CLEAR_SCREEN
        ? true
        : (writeToTerminal as (...args: unknown[]) => boolean)(chunk, ...rest)) as typeof process.stdout.write);

  const { render } = await import('ink');
  const { runApp } = await import('../../app.js');
  const stdout = new FakeStdout();
  const stdin = new FakeStdin();
  let unmount: () => void = () => undefined;

  // Not awaited: it resolves when the app exits.
  void runApp(
    (element) => {
      const instance = render(element, {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      });
      unmount = instance.unmount;
      return { waitUntilExit: () => instance.waitUntilExit(), clear: instance.clear };
    },
    { prompt: [] },
  );

  // The app attaches its input listener just after the first frame, so keys sent before that are lost.
  await sleep(200);

  const screen = (): string => stdout.last.replace(ANSI, '');
  const settle = (): Promise<void> => sleep(40);
  const matches = (text: string | RegExp): boolean =>
    typeof text === 'string' ? screen().includes(text) : text.test(screen());

  return {
    screen,
    press: async (key) => {
      stdin.write(KEY_BYTES[key]);
      await settle();
    },
    type: async (text) => {
      stdin.write(text);
      await settle();
    },
    waitForText: async (text, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!matches(text)) {
        if (Date.now() > deadline)
          throw new Error(`e2e: "${String(text)}" never appeared. The screen was:\n${screen()}`);
        await sleep(25);
      }
    },
    stop: async () => {
      unmount();
      quietWrite.mockRestore();
      vi.unstubAllGlobals();
      PROCESS_EVENTS.forEach((event, index) => {
        for (const listener of emitter.listeners(event)) {
          if (!listenersBefore[index]!.has(listener)) emitter.off(event, listener as (...args: unknown[]) => void);
        }
      });
    },
  };
}
