const APP = 'contentful.experience-design-system-cli';

const OS_NAMES: Record<string, string> = {
  android: 'Android',
  aix: 'Linux',
  darwin: 'macOS',
  freebsd: 'Linux',
  linux: 'Linux',
  openbsd: 'Linux',
  sunos: 'Linux',
  win32: 'Windows',
};

/**
 * X-Contentful-User-Agent for CMA requests, in CEP-0056 format:
 * `app <name>/<ver>; platform node.js/<ver>; os <name>/<ver>;`.
 *
 * Caller passes the CLI package version — this helper is pure (no file reads).
 */
export function buildUserAgent(version: string): string {
  const parts = [`app ${APP}/${version}`, `platform node.js/${process.version}`];
  const os = OS_NAMES[process.platform];
  if (os) parts.push(`os ${os}/${process.version}`);
  return `${parts.join('; ')};`;
}
