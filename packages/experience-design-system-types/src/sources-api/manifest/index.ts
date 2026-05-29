export interface ManifestPayload {
  componentsManifest?: Record<string, unknown>;
  tokensManifest?: Record<string, unknown>;
}

export { buildManifest, buildFilteredManifest, stripUnsupportedSlotFields } from './utils.js';
