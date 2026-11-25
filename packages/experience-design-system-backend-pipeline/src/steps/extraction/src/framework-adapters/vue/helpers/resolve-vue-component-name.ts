import { basename, dirname } from 'node:path';

export function resolveVueComponentName(filePath: string): string {
  const fileName = basename(filePath, '.vue');
  if (fileName !== 'index') {
    return fileName;
  }
  return basename(dirname(filePath)) || fileName;
}
