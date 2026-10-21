import { cloneJson, own } from '../property-contract/json-value.js';
import { CDF_SCHEMA_URL } from './schema.js';
import type { CDFComponentEntry, CDFTokenEntry, CDFValidationError } from './types.js';

/** Preserve the complete local slot contract, including explicit false requiredness. */
export function stripUnsupportedSlotFields(entry: CDFComponentEntry): CDFComponentEntry {
  return cloneJson(entry);
}

const COLLISION_LEAF_KEY = 'default';

/** A token path that is also the parent of other token paths cannot be both
 * in a nested tree, so the leaf moves to a `default` child (suffixed with `_`
 * until it is unique). */
function resolveTokenPathCollisions(
  tokens: Array<{ path: string; entry: CDFTokenEntry }>,
): Array<{ path: string; entry: CDFTokenEntry }> {
  const taken = new Set(tokens.map((token) => token.path));
  const parents = new Set<string>();
  for (const path of taken) {
    const segments = path.split('.');
    for (let i = 1; i < segments.length; i += 1) parents.add(segments.slice(0, i).join('.'));
  }
  return tokens.map((token) => {
    if (!parents.has(token.path)) return token;
    let key = COLLISION_LEAF_KEY;
    while (taken.has(`${token.path}.${key}`)) key += '_';
    const path = `${token.path}.${key}`;
    taken.add(path);
    return { path, entry: token.entry };
  });
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

  components = expandCDFModelDependencies(components);
  const componentKeys = components.map((component) => component.key);
  const tokenPaths = tokens.map((token) => token.path);
  if (new Set(componentKeys).size !== componentKeys.length || new Set(tokenPaths).size !== tokenPaths.length)
    throw new Error('CDF path collision');
  if (componentKeys.some((key) => tokenPaths.includes(key))) throw new Error('CDF component/token path collision');
  const doc: CDFDocument = { $schema: CDF_SCHEMA_URL };
  for (const { key, entry } of components) {
    setAtPath(doc, key, stripUnsupportedSlotFields(entry));
  }
  for (const { path, entry } of resolveTokenPathCollisions(tokens)) {
    setAtPath(doc, path, cloneJson(entry));
  }
  return doc;
}

/** Resolve only the generated definitions owned and reached by selected roots. */
export function expandCDFModelDependencies<T extends { key: string; entry: CDFComponentEntry }>(
  components: T[],
): Array<T | { key: string; entry: CDFComponentEntry }> {
  const keys = new Map<string, T | { key: string; entry: CDFComponentEntry }>();
  for (const component of components) {
    if (keys.has(component.key)) throw new Error('Selected component key collision');
    keys.set(component.key, component);
  }
  const inserted = new Set<string>();
  for (const component of components)
    for (const plan of Object.values(component.entry.$representationPlans ?? {})) {
      const models = new Map(plan.models.map((model) => [model.key, model]));
      if (models.size !== plan.models.length) throw new Error('Duplicate representation dependency');
      const pending = [...(plan.attachment?.definition.$allowedComponents ?? [])];
      const visited = new Set<string>();
      while (pending.length) {
        const key = pending.pop()!;
        if (visited.has(key)) continue;
        visited.add(key);
        const model = models.get(key);
        if (
          !model ||
          model.entry.$model?.planId !== plan.id ||
          model.entry.$model.componentId !== plan.identity.componentId ||
          model.entry.$model.propertyId !== plan.identity.propertyId
        )
          throw new Error('Unreachable or cross-owner representation model');
        const existing = keys.get(key);
        if (inserted.has(key) || (existing && JSON.stringify(existing.entry) !== JSON.stringify(model.entry)))
          throw new Error('Representation dependency key collision');
        if (!existing) {
          keys.set(key, { key, entry: cloneJson(model.entry) });
          inserted.add(key);
        }
        for (const slot of Object.values(model.entry.$slots ?? {})) pending.push(...(slot.$allowedComponents ?? []));
      }
      if (visited.size !== plan.models.length) throw new Error('Orphan representation model dependency');
    }
  return [...keys.values()];
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
    if (value !== undefined) setAtPath(filtered, dottedPath, cloneJson(value));
  }
  const roots: Array<{ key: string; entry: CDFComponentEntry }> = [];
  for (const key of selectedComponentKeys) {
    const entry = getAtPath(fullDocument, key);
    if (entry && typeof entry === 'object' && (entry as CDFComponentEntry).$type === 'component')
      roots.push({ key, entry: entry as CDFComponentEntry });
  }
  for (const dependency of expandCDFModelDependencies(roots))
    if (!selected.has(dependency.key)) setAtPath(filtered, dependency.key, cloneJson(dependency.entry));
  for (const key of [
    ...selected,
    ...roots.flatMap((root) => expandCDFModelDependencies([root]).map((entry) => entry.key)),
  ]) {
    const segments = key.split('.');
    for (let length = 1; length < segments.length; length++) {
      const parent = segments.slice(0, length).join('.');
      const source = getAtPath(fullDocument, parent);
      const target = getAtPath(filtered, parent);
      if (source && target && typeof source === 'object' && typeof target === 'object' && own(source, '$description'))
        Object.defineProperty(target, '$description', {
          value: cloneJson((source as Record<string, unknown>).$description),
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
  }
  return Object.keys(filtered).length > 1 ? filtered : undefined;
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
  if (segments.some((segment) => !segment)) throw new Error('Invalid CDF path');
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const next = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (next !== undefined && (typeof next !== 'object' || next === null || own(next, '$type')))
      throw new Error('CDF group/leaf path collision');
    if (next === undefined) {
      Object.defineProperty(cursor, segment, {
        value: Object.create(null),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  if (own(cursor, segments[segments.length - 1])) throw new Error('CDF path collision');
  Object.defineProperty(cursor, segments[segments.length - 1], {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function getAtPath(root: Record<string, unknown>, dottedPath: string): unknown {
  const segments = dottedPath.split('.');
  let cursor: unknown = root;
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    if (!Object.hasOwn(cursor, segment)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
