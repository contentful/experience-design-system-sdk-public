import { isRecord } from './connection.js';

const codes = new Set([
  'contextWindowExceeded',
  'sessionBudgetExceeded',
  'usageLimitExceeded',
  'rateLimitExceeded',
  'flexUnavailable',
  'serverOverloaded',
  'modelNotFound',
  'policyCapacityUnavailable',
  'cyberPolicy',
  'misalignmentPolicyViolation',
  'tooManyDenials',
  'internalServerError',
  'unauthorized',
  'badRequest',
  'threadRollbackFailed',
  'sandboxError',
  'other',
]);
const connectionCodes = [
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
];

export function readTurnFailure(error: unknown): { code: string; httpStatusCode?: number } | undefined {
  const info = isRecord(error) ? error.codexErrorInfo : undefined;
  if (typeof info === 'string' && codes.has(info)) return { code: info };
  if (!isRecord(info)) return undefined;
  for (const code of connectionCodes) {
    const details = info[code];
    if (!isRecord(details)) continue;
    const status = details.httpStatusCode;
    return {
      code,
      ...(typeof status === 'number' && Number.isSafeInteger(status) && status >= 0 && status <= 65535
        ? { httpStatusCode: status }
        : {}),
    };
  }
  if (isRecord(info.activeTurnNotSteerable)) return { code: 'activeTurnNotSteerable' };
  return undefined;
}
