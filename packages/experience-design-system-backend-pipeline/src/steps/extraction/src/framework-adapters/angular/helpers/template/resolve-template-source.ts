import { readFile } from 'node:fs/promises';
import type { AngularComponentMetadata } from '../types/angular-metadata.js';

/**
 * Return the template HTML for a component — either the inline `template:`
 * string or the file contents at `templateUrl`. Returns `null` when the
 * component declares no template (abstract class, host-less directive).
 *
 * Missing external template files resolve to `null` with no error — the
 * extractor emits the component with zero slots instead of failing extraction.
 */
export async function resolveTemplateSource(meta: AngularComponentMetadata): Promise<string | null> {
  if (meta.inlineTemplate !== null) return meta.inlineTemplate;
  if (meta.templatePath === null) return null;
  try {
    return await readFile(meta.templatePath, 'utf8');
  } catch {
    return null;
  }
}
