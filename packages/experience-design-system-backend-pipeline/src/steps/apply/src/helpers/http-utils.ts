const MAX_RETRY_AFTER_MS = 60_000;

export function isTransientStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

export function retryAfterMs(response: Response): number | undefined {
  const value = response.headers?.get('retry-after')?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const delayMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_AFTER_MS) return undefined;
  return Math.round(delayMs);
}

export function isApsDenialBody(body: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { sys?: { id?: unknown } };
    const id = parsed?.sys?.id;
    return id === 'NotFound' || id === 'AccessDenied';
  } catch {
    return false;
  }
}

export function stringifyError(error: unknown): string {
  return typeof error === 'string' ? error : JSON.stringify(error ?? {});
}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
