import { ApiError, formatApiError, ImportApiClient } from '@contentful/experience-design-system-backend-pipeline';
import { toApiHost, type CredentialValues } from './logic.js';

export type ValidationResult = { ok: true } | { ok: false; error: string };

export async function validateCredentials(values: CredentialValues): Promise<ValidationResult> {
  const host = toApiHost(values.host);
  const client = new ImportApiClient({
    host,
    spaceId: values.spaceId,
    environmentId: values.environmentId,
    cmaToken: values.cmaToken,
  });
  try {
    await client.validateToken();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toUserError(error, host) };
  }
}

function toUserError(error: unknown, host: string): string {
  if (error instanceof ApiError) {
    const detail = formatApiError({ error });
    if (error.status === 404 && error.message.startsWith('preflight failed:')) {
      return `Not found. Check the space ID, environment and API host.\n${detail}`;
    }
    return detail;
  }
  if (error instanceof Error) return `Could not reach ${host}: ${error.message}`;
  return String(error);
}
