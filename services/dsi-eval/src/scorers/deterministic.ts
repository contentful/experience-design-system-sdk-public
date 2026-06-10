import { CDF_PROPERTY_TYPES } from '@contentful/experience-design-system-types/src/cdf/vocabularies.js';
import type { CDFFile, CDFComponentEntry } from '@contentful/experience-design-system-types/src/cdf/types.js';
import type { CorpusEntry, ComponentCoverageResult, HallucinationResult } from '../types.js';

export function scoreComponentCoverage(cdf: CDFFile, corpus: CorpusEntry): ComponentCoverageResult {
  const expected = corpus.expectedComponents.filter((c) => c.verdict !== 'missed');
  const outputKeys = new Set(
    Object.entries(cdf)
      .filter(([k, v]) => k !== '$schema' && typeof v === 'object' && v !== null && '$type' in v)
      .map(([k]) => k),
  );

  const missed = expected.filter((c) => !outputKeys.has(c.name)).map((c) => c.name);

  return {
    expected: expected.length,
    found: expected.length - missed.length,
    missed,
    ratio: expected.length === 0 ? 1 : (expected.length - missed.length) / expected.length,
  };
}

export function scoreHallucination(cdf: CDFFile): HallucinationResult {
  const validTypes = new Set<string>(CDF_PROPERTY_TYPES);
  const violations: HallucinationResult['violations'] = [];

  for (const [key, value] of Object.entries(cdf)) {
    if (key === '$schema' || typeof value !== 'object' || value === null) continue;
    const entry = value as CDFComponentEntry;
    if (entry.$type !== 'component') continue;

    for (const [propName, prop] of Object.entries(entry.$properties ?? {})) {
      if (!validTypes.has(prop.$type)) {
        violations.push({ component: key, prop: propName, invalidType: prop.$type });
      }
    }
  }

  return { pass: violations.length === 0, violations };
}
