import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const APP = 'contentful.experience-design-system-cli';

// process.platform → CEP-0056 os name, mirroring contentful-sdk-core's
// getNodeOS so the header parses identically to SDK-originated traffic.
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
 * X-Contentful-User-Agent for the CLI's CMA requests, so writes are
 * attributable to the DSI CLI as their origin. Format follows CEP-0056:
 * `app <name>/<ver>; platform node.js/<ver>; os <name>/<ver>;`. Carries only
 * the app/platform/os segments — no user- or content-identifying data.
 */
export function buildUserAgent(version: string = pkg.version): string {
  const parts = [`app ${APP}/${version}`, `platform node.js/${process.version}`];
  const os = OS_NAMES[process.platform];
  if (os) parts.push(`os ${os}/${process.version}`);
  return `${parts.join('; ')};`;
}
