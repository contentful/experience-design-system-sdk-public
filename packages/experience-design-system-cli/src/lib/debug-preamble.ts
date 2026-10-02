import { initDebugLogger, printDebugBanner, resolveDebugMode, type DebugLogger } from './debug-logger.js';
import { readExperiencesCredentials } from '../credentials-store.js';

let endBannerRegistered = false;

/**
 * Resolve and initialize the debug logger before a top-level command runs.
 */
export async function beginCommand(command: string, opts: { debug?: boolean }): Promise<DebugLogger> {
  let configDebug: boolean | undefined;
  try {
    const creds = await readExperiencesCredentials();
    configDebug = creds.debug;
  } catch {
    // Missing credentials.json is fine — the resolver falls through to OFF.
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
