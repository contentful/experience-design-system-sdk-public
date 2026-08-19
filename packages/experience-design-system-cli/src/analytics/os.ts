import type { OsName } from './types.js';

const OS_NAMES: Record<string, OsName> = {
  android: 'Android',
  aix: 'Linux',
  darwin: 'macOS',
  freebsd: 'Linux',
  linux: 'Linux',
  openbsd: 'Linux',
  sunos: 'Linux',
  win32: 'Windows',
};

export function getOsName(): OsName {
  return OS_NAMES[process.platform] ?? 'other';
}
