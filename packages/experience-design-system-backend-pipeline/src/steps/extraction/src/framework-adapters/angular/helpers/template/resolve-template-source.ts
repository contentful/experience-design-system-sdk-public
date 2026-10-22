import { readFile } from 'node:fs/promises';
import type { AngularComponentMetadata } from '../../types/angular-metadata.js';

export async function resolveTemplateSource(meta: AngularComponentMetadata): Promise<string | null> {
  if (meta.inlineTemplate !== null) return meta.inlineTemplate;
  if (meta.templatePath === null) return null;
  try {
    return await readFile(meta.templatePath, 'utf8');
  } catch {
    return null;
  }
}
