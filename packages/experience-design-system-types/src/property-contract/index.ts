// Pillar #4 foundation — property-contract target types + validators.
// Dormant on `development` until downstream consumers (new extractors,
// generation, review UI) activate them. Shape is deliberately verbatim
// with the upstream work on feat/import-pipeline-evidence-and-reasoning
// so the two merge without drift. See INTEG-5147 (spike) / INTEG-4927.
export * from './json-value.js';
export * from './date-time-value.js';
export * from './discriminated-union.js';
export * from './target-definition.js';
