import { basename, dirname } from 'node:path';

const ANATOMY_FOLDERS = new Set(['anatomy', 'parts']);

export function getSvelteComponentName(filePath: string): string {
  const file = basename(filePath, '.svelte');
  const parentDir = basename(dirname(filePath));
  if (file === 'index') return toPascalCase(parentDir);
  if (ANATOMY_FOLDERS.has(parentDir)) {
    const grandparent = basename(dirname(dirname(filePath)));
    if (grandparent && grandparent !== '.' && grandparent !== '/') {
      return `${toPascalCase(grandparent)}${toPascalCase(file)}`;
    }
  }
  return toPascalCase(file);
}

function toPascalCase(s: string): string {
  if (!s) return s;
  if (/^[A-Z]/.test(s) && !s.includes('-') && !s.includes('_')) return s;
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
