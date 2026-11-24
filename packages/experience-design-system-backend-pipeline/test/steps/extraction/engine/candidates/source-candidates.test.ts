import { describe, expect, it } from 'vitest';
import {
  describeSourceDomain,
  mergeSourceCandidates,
} from '../../../../../src/steps/extraction/src/candidates/source-candidates.js';
import type { SourceCandidateObservation } from '../../../../../src/steps/extraction/src/candidates/types.js';

function observation(
  name: string,
  evidenceKind: SourceCandidateObservation['evidenceKind'],
  overrides: Partial<SourceCandidateObservation> = {},
): SourceCandidateObservation {
  return {
    name,
    keyPath: [name],
    evidenceKind,
    type: 'string',
    declaredRequired: false,
    sourceDefault: null,
    origin: 'unknown',
    location: null,
    ...overrides,
  };
}

describe('source candidates', () => {
  it('keeps arbitrary own names as exact key segments', () => {
    const names = ['__proto__', 'constructor', 'prototype', 'a.b/c', '0', ''];
    const { candidates } = mergeSourceCandidates(
      names.map((name) => observation(name, 'declaration')),
      [],
      [],
    );

    expect(candidates.map((candidate) => candidate.name)).toEqual(
      [...names].sort((left, right) => left.localeCompare(right)),
    );
    expect(candidates.find((candidate) => candidate.name === 'a.b/c')?.keyPath).toEqual(['a.b/c']);
    expect(candidates.find((candidate) => candidate.name === '__proto__')?.name).toBe('__proto__');
  });

  it('keeps declared values authoritative and retains conflicting fallback observations', () => {
    const declared = observation('density', 'declaration', {
      type: "'compact' | 'comfortable'",
      declaredRequired: true,
      sourceDefault: null,
      origin: 'own',
      fact: {
        origin: 'own',
        resolvedKind: 'union',
        certainty: 'certain',
        ambiguityReason: null,
        declarations: [],
        sourceTypeText: "'compact' | 'comfortable'",
        domain: {
          observedLiterals: [
            { kind: 'string', value: 'compact' },
            { kind: 'string', value: 'comfortable' },
          ],
          openness: 'closed',
        },
        declaredRequired: true,
        sourceDefault: null,
        advisoryShape: null,
        shapeNotes: [],
        requiredFieldDropped: null,
      },
    });
    const fallback = observation('density', 'binding', {
      type: 'string',
      declaredRequired: false,
      sourceDefault: 'theme.density',
      origin: 'unknown',
    });

    const { candidates } = mergeSourceCandidates([fallback, declared], [], []);
    const candidate = candidates[0]!;

    expect(candidate.type).toBe("'compact' | 'comfortable'");
    expect(candidate.declaredRequired).toBe(true);
    expect(candidate.sourceDefault).toBeNull();
    expect(candidate.evidenceKinds).toEqual(['declaration', 'binding']);
    expect(candidate.observations).toHaveLength(2);
    expect(candidate.facts?.certainty).toBe('certain');
  });

  it('does not turn literal observations from an open domain into a closed enumeration', () => {
    expect(describeSourceDomain("'small' | 'large'").openness).toBe('closed');
    expect(describeSourceDomain("'small' | 'large' | string")).toMatchObject({
      observedLiterals: [
        { kind: 'string', value: 'small' },
        { kind: 'string', value: 'large' },
      ],
      openness: 'open',
    });
    expect(describeSourceDomain('string')).toMatchObject({ observedLiterals: [], openness: 'open' });
    expect(describeSourceDomain('SomeImportedType').openness).toBe('unknown');
  });

  it('records current prop or slot projection without deleting a source candidate', () => {
    const source = observation('children', 'declaration', { type: 'ReactNode' });
    const { candidates } = mergeSourceCandidates([source], [], [{ name: 'children', isDefault: true }]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.projection).toEqual({ kind: 'slot', reason: 'current-slot-projection' });
  });
});
