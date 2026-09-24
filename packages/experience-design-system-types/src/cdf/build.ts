import { CDF_SCHEMA_URL } from './schema.js';
import type { CDFComponentEntry, CDFTokenEntry, CDFValidationError } from './types.js';

/** Drops `$required` from slot definitions — the server never reads it and
 * older CDF consumers reject unknown slot fields. */
export function stripUnsupportedSlotFields(entry: CDFComponentEntry): CDFComponentEntry {
  if (!entry.$slots) return entry;
  const cleaned: CDFComponentEntry['$slots'] = {};
  for (const [name, slot] of Object.entries(entry.$slots)) {
    const { $required: _required, ...rest } = slot as Record<string, unknown>;
    cleaned![name] = rest as NonNullable<CDFComponentEntry['$slots']>[string];
  }
  return { ...entry, $slots: cleaned };
}

/** A CDF document — the single file/wire payload for both components and
 * design tokens. There is no separate manifest envelope. */
export interface CDFDocument {
  $schema: typeof CDF_SCHEMA_URL;
  [key: string]: unknown;
}

export function buildCDF(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
  tokens: Array<{ path: string; entry: CDFTokenEntry }>,
  opts: { deleteAll?: boolean } = {},
): CDFDocument | undefined {
  if (components.length === 0 && tokens.length === 0 && !opts.deleteAll) return undefined;

  const doc: CDFDocument = { $schema: CDF_SCHEMA_URL };
  for (const { key, entry } of components) {
    setAtPath(doc, key, stripUnsupportedSlotFields(entry));
  }
  for (const { path, entry } of tokens) {
    setAtPath(doc, path, entry);
  }
  return doc;
}

/**
 * Filters a CDF document down to a selected subset of component keys and
 * token paths, preserving the group nesting each dotted path implies.
 */
export function buildFilteredCDF(
  fullDocument: CDFDocument,
  selectedComponentKeys: Set<string>,
  selectedTokenPaths: Set<string>,
): CDFDocument | undefined {
  const selected = new Set<string>([...selectedComponentKeys, ...selectedTokenPaths]);
  if (selected.size === 0) return undefined;

  const filtered: CDFDocument = { $schema: CDF_SCHEMA_URL };
  for (const dottedPath of selected) {
    const value = getAtPath(fullDocument, dottedPath);
    if (value !== undefined) setAtPath(filtered, dottedPath, value);
  }
  return filtered;
}

/**
 * Document-local pre-flight for `$allowedComponents` references: every entry
 * must resolve to another component in the same document, or be left for the
 * server to resolve against the target environment (this function has no
 * network access, so it cannot tell "doesn't exist anywhere" from "exists
 * only in the target env" — it only flags names absent from `components`).
 *
 * Mirrors the error shape `previewImport`/`applyImport` return for the
 * equivalent server-side check, so callers can route both through the same
 * `path`/`message` handling — just without a round-trip when the typo is
 * local to the document itself. The `manifest:` path prefix below is a wire
 * contract with the server's own error shape — keep it as-is even though the
 * rest of this module no longer says "manifest".
 */
export function validateSlotReferences(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): CDFValidationError[] {
  const componentKeys = new Set(components.map((c) => c.key));

  const errors: CDFValidationError[] = [];
  for (const { key, entry } of components) {
    const slots = entry.$slots ?? {};
    for (const [slotKey, slot] of Object.entries(slots)) {
      const allowed = slot?.$allowedComponents ?? [];
      const unresolved = allowed.filter((name) => !componentKeys.has(name));
      if (unresolved.length === 0) continue;
      errors.push({
        path: `manifest:components/${key}/$slots/${slotKey}/$allowedComponents`,
        message:
          `Unresolved $allowedComponents reference(s): ${unresolved.join(', ')}. ` +
          `Not found in this document — if not an existing Component in the target ` +
          `environment either, the server will reject this on preview/apply.`,
      });
    }
  }
  return errors;
}

function setAtPath(root: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split('.');
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = cursor[segment];
    if (typeof next !== 'object' || next === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function getAtPath(root: Record<string, unknown>, dottedPath: string): unknown {
  const segments = dottedPath.split('.');
  let cursor: unknown = root;
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
