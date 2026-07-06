import { initDebugLogger, printDebugBanner, resolveDebugMode, type DebugLogger } from './debug-logger.js';
import { readExperiencesCredentials } from '../credentials-store.js';

let endBannerRegistered = false;

/**
 * Preamble every top-level command action should call before doing work.
 *
 * Resolves the effective debug decision (flag > env > persisted config),
 * initializes the singleton, and prints the bright-green start banner.
 * Registers a process-exit handler that prints the end banner once.
 *
 * Returns the logger so the caller can emit events without a second import.
 * When debug is disabled, the returned logger is a no-op.
 */
export async function beginCommand(command: string, opts: { debug?: boolean }): Promise<DebugLogger> {
  let configDebug: boolean | undefined;
  try {
    const creds = await readExperiencesCredentials();
    configDebug = creds.debug;
  } catch {
    // Missing credentials.json is fine — the resolver falls through to default OFF.
  }
  const enabled = resolveDebugMode(opts, configDebug);
  const logger = initDebugLogger({ enabled, command });
  if (logger.enabled) {
    printDebugBanner(logger, 'start');
    if (!endBannerRegistered) {
      endBannerRegistered = true;
      process.on('exit', () => printDebugBanner(logger, 'end'));
    }
  }
  return logger;
}
