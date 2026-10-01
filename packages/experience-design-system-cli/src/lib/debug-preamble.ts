import { initDebugLogger, printDebugBanner, type DebugLogger } from './debug-logger.js';
import { readExperiencesCredentials } from '../credentials-store.js';

let endBannerRegistered = false;

/**
 * Initialize the debug logger from persisted credentials.
 * Debug mode can only be configured via setup preferences;
 */
export async function beginCommand(command: string): Promise<DebugLogger> {
  let configDebug: boolean | undefined;
  try {
    const creds = await readExperiencesCredentials();
    configDebug = creds.debug;
  } catch {
    // Missing credentials.json is fine — defaults to OFF.
  }
  const enabled = configDebug ?? false;
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
