import { toApiHost, type CredentialValues } from './logic.js';

export type ValidationResult = { ok: true } | { ok: false; error: string };

const USER_AGENT = 'app contentful.experience-design-system-cli';

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'X-Contentful-User-Agent': USER_AGENT };
}

function isApsDenial(body: string): boolean {
  try {
    const id = (JSON.parse(body) as { sys?: { id?: unknown } }).sys?.id;
    return id === 'NotFound' || id === 'AccessDenied';
  } catch {
    return false;
  }
}

function messageFrom(body: string): string | undefined {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    return typeof message === 'string' && message !== '' ? message : undefined;
  } catch {
    return undefined;
  }
}

// TODO: move this to the backend package (ImportApiClient.validateToken) once v2 depends on it (INTEG-4964).
export async function validateCredentials(values: CredentialValues): Promise<ValidationResult> {
  const base = toApiHost(values.host);

  let me: Response;
  try {
    me = await fetch(`${base}/users/me`, { headers: headers(values.cmaToken) });
  } catch (error) {
    return { ok: false, error: `Could not reach ${base}: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (me.status === 401) return { ok: false, error: 'CMA token is invalid or revoked.' };
  if (!me.ok) return { ok: false, error: `Unexpected error validating the token (${me.status}).` };

  let preflight: Response;
  try {
    preflight = await fetch(
      `${base}/spaces/${values.spaceId}/environments/${values.environmentId}/design_systems/preflight`,
      { headers: headers(values.cmaToken) },
    );
  } catch {
    return { ok: true };
  }
  if (preflight.ok || preflight.status >= 500) return { ok: true };

  const body = await preflight.text();
  if (preflight.status === 404 && !isApsDenial(body)) return { ok: true };

  const detail = messageFrom(body);
  if (preflight.status === 403) {
    return { ok: false, error: `Access denied. ${detail ?? 'Your token cannot write design system components here.'}` };
  }
  if (preflight.status === 404) {
    return {
      ok: false,
      error: `Not found. Check the space ID, environment and API host.${detail ? ` (${detail})` : ''}`,
    };
  }
  return { ok: false, error: `Credential check failed (${preflight.status}).${detail ? ` ${detail}` : ''}` };
}
