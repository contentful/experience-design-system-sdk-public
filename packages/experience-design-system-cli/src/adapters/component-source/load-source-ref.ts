import { readFile } from 'node:fs/promises';
import type { ComponentSourceRef } from '@contentful/experience-design-system-generation';
import { excerptAroundNames } from '../../session/source-excerpt.js';
import { MAX_COMPONENT_SOURCE_CHARS } from './constants.js';
import { identifiersIn } from './extract-relative-imports.js';
import { loadSiblingFiles } from './walk-sibling-imports.js';

// Reads and inlines real file content here, at the last point this pipeline
// has local filesystem access — the map-tokens/generate-components agent
// invocations are deliberately filesystem-free (stdout-only tool-call
// protocol), so a bare path is useless to them. Read failures (file moved or
// deleted since extraction) resolve to `content: null`, not a thrown error —
// callers fall back to inferring from the prop name and $token.kind alone.
export async function loadComponentSourceRef(
  name: string,
  sourcePath: string,
  propNames: string[] = [],
  propTypes: string[] = [],
): Promise<ComponentSourceRef> {
  let content: string | null = null;
  let siblingFiles: Array<{ path: string; content: string }> = [];
  let truncatedSiblingCount = 0;
  const usesNotShown = new Set<string>();
  try {
    const rawText = await readFile(sourcePath, 'utf8');
    // Siblings first: the component's own excerpt is keyed on the same
    // declared-type-name set.
    let siblingUsesNotShown: string[];
    let declaredTypeNames: string[];
    ({
      siblings: siblingFiles,
      truncatedCount: truncatedSiblingCount,
      usesNotShown: siblingUsesNotShown,
      declaredTypeNames,
    } = await loadSiblingFiles(rawText, sourcePath, propNames, identifiersIn(propTypes)));
    // Prop names locate the *use* of a prop; the declared type names locate
    // the *members* the classifier has to emit. Both are needed.
    const mainExcerpt = excerptAroundNames(
      rawText,
      [...new Set([...propNames, ...declaredTypeNames])],
      MAX_COMPONENT_SOURCE_CHARS,
    );
    content = mainExcerpt.content;
    for (const name of mainExcerpt.usesNotShown) usesNotShown.add(name);
    for (const name of siblingUsesNotShown) usesNotShown.add(name);
  } catch {
    // File no longer exists or unreadable — leave content null.
  }
  const ref: ComponentSourceRef = { component: name, sourcePath, content };
  if (siblingFiles.length > 0) ref.siblingFiles = siblingFiles;
  if (truncatedSiblingCount > 0) ref.truncatedSiblingCount = truncatedSiblingCount;
  const notShown = propNames.filter((name) => usesNotShown.has(name));
  if (notShown.length > 0) ref.usesNotShown = notShown;
  return ref;
}
