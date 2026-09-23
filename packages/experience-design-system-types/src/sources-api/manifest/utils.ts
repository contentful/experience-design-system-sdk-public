import { CDF_V1_SCHEMA_URL } from '../../cdf/index.js';
import type { CDFComponentEntry, CDFValidationError } from '../../cdf/index.js';
import type { DTCGTokenEntry } from '../../dtcg/types.js';
import type { ManifestPayload } from './index.js';

export function stripUnsupportedSlotFields(entry: CDFComponentEntry): CDFComponentEntry {
  if (!entry.$slots) return entry;
  const cleaned: CDFComponentEntry['$slots'] = {};
  for (const [name, slot] of Object.entries(entry.$slots)) {
    const { $required: _required, ...rest } = slot as Record<string, unknown>;
    cleaned![name] = rest as NonNullable<CDFComponentEntry['$slots']>[string];
  }
  return { ...entry, $slots: cleaned };
}

export function buildManifest(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
  tokens: DTCGTokenEntry[],
  opts: { deleteAllComponents?: boolean } = {},
): ManifestPayload {
  const manifest: ManifestPayload = {};
  // With components, emit them. With none, normally omit the key entirely — but
  // when `deleteAllComponents` is set, emit an empty-but-present manifest so the
  // server diffs it as "remove every existing component" (delete-all). An
  // omitted key is a no-op; a present-empty one is an explicit clear.
  if (components.length > 0 || opts.deleteAllComponents) {
    const componentsObj: Record<string, unknown> = { $schema: CDF_V1_SCHEMA_URL };
    for (const { key, entry } of components) {
      componentsObj[key] = stripUnsupportedSlotFields(entry);
    }
    manifest.componentsManifest = componentsObj;
  }
  if (tokens.length > 0) {
    const tokensObj: Record<string, unknown> = {};
    for (const token of tokens) {
      tokensObj[token.path] = {
        $type: token.$type,
        $value: token.$value,
        ...(token.$description ? { $description: token.$description } : {}),
      };
    }
    manifest.tokensManifest = tokensObj;
  }
  return manifest;
}

/**
 * Manifest-local pre-flight for `$allowedComponents` references: every entry
 * must resolve to another component in the same manifest, or be left for the
 * server to resolve against the target environment (this function has no
 * network access, so it cannot tell "doesn't exist anywhere" from "exists
 * only in the target env" — it only flags names absent from `components`).
 *
 * Mirrors the error shape `previewImport`/`applyImport` return for the
 * equivalent server-side check, so callers can route both through the same
 * `path`/`message` handling — just without a round-trip when the typo is
 * local to the manifest itself.
 */
export function validateManifestSlotReferences(
  components: Array<{ key: string; entry: CDFComponentEntry }>,
): CDFValidationError[] {
  const manifestKeys = new Set(components.map((c) => c.key));

  const errors: CDFValidationError[] = [];
  for (const { key, entry } of components) {
    const slots = entry.$slots ?? {};
    for (const [slotKey, slot] of Object.entries(slots)) {
      const allowed = slot?.$allowedComponents ?? [];
      const unresolved = allowed.filter((name) => !manifestKeys.has(name));
      if (unresolved.length === 0) continue;
      errors.push({
        path: `manifest:components/${key}/$slots/${slotKey}/$allowedComponents`,
        message:
          `Unresolved $allowedComponents reference(s): ${unresolved.join(', ')}. ` +
          `Not found in this manifest — if not an existing Component in the target ` +
          `environment either, the server will reject this on preview/apply.`,
      });
    }
  }
  return errors;
}

export function buildFilteredManifest(
  fullManifest: ManifestPayload,
  selectedComponentKeys: Set<string>,
  selectedTokenPaths: Set<string>,
): ManifestPayload {
  const filtered: ManifestPayload = {};
  if (fullManifest.componentsManifest) {
    const obj: Record<string, unknown> = {};
    if (fullManifest.componentsManifest['$schema']) {
      obj['$schema'] = fullManifest.componentsManifest['$schema'];
    }
    for (const [key, value] of Object.entries(fullManifest.componentsManifest)) {
      if (key === '$schema') continue;
      if (selectedComponentKeys.has(key)) obj[key] = value;
    }
    if (Object.keys(obj).length > 1) filtered.componentsManifest = obj;
  }
  if (fullManifest.tokensManifest) {
    const obj: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(fullManifest.tokensManifest)) {
      if (selectedTokenPaths.has(path)) obj[path] = value;
    }
    if (Object.keys(obj).length > 0) filtered.tokensManifest = obj;
  }
  return filtered;
}
