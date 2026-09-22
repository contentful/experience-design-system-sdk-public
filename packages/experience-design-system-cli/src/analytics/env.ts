import { debugEnvForSubprocess } from '../lib/debug-logger.js';
import { ANALYTICS_SESSION_ENV, IMPORT_PIPELINE_ENV } from './constants.js';

/** Merge pipeline analytics env into a subprocess environment. */
function analyticsEnvForSubprocess(env: NodeJS.ProcessEnv, analyticsSessionId: string): NodeJS.ProcessEnv {
  return {
    ...env,
    [IMPORT_PIPELINE_ENV]: '1',
    [ANALYTICS_SESSION_ENV]: analyticsSessionId,
  };
}

/** Debug + pipeline analytics environment helpers. */
export function pipelineSubprocessEnv(env: NodeJS.ProcessEnv, analyticsSessionId: string): NodeJS.ProcessEnv {
  return analyticsEnvForSubprocess(debugEnvForSubprocess(env), analyticsSessionId);
}
