import { CDF_V1_SCHEMA_URL } from '../../cdf/index.js';
import type { CDFComponentEntry } from '../../cdf/index.js';
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
