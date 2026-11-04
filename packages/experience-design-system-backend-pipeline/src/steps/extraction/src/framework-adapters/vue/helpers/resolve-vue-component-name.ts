import { basename, dirname } from 'node:path';

/** Derives the component name from its .vue file path (uses parent directory name for index.vue files). */
export function resolveVueComponentName(filePath: string): string {
  const fileName = basename(filePath, '.vue');
  if (fileName !== 'index') {
    return fileName;
  }
  return basename(dirname(filePath)) || fileName;
}
