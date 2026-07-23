import { describe, it, expect } from 'vitest';
import {
  validateInterchangeMap,
  groupsToEdges,
  edgesToGroups,
  type CompositionEdge,
} from '../../../src/analyze/composition/interchange-schema.js';

describe('interchange schema (T1)', () => {
  describe('validateInterchangeMap', () => {
    it('accepts a well-formed groups map', () => {
      const result = validateInterchangeMap({
        version: 1,
        groups: { SectionTab: ['Section3Up', 'Section2Up'], Section3Up: ['CaseStudyCard'] },
      });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.map.version).toBe(1);
        expect(result.map.groups.SectionTab).toEqual(['Section3Up', 'Section2Up']);
      }
    });

    it('rejects a non-object', () => {
      expect(validateInterchangeMap(null).valid).toBe(false);
      expect(validateInterchangeMap('nope').valid).toBe(false);
      expect(validateInterchangeMap(42).valid).toBe(false);
    });

    it('rejects a wrong version', () => {
      const r = validateInterchangeMap({ version: 2, groups: {} });
      expect(r.valid).toBe(false);
    });

    it('rejects groups whose values are not string arrays', () => {
      expect(validateInterchangeMap({ version: 1, groups: { A: 'B' } }).valid).toBe(false);
      expect(validateInterchangeMap({ version: 1, groups: { A: [1, 2] } }).valid).toBe(false);
    });

    it('accepts an empty groups map', () => {
      expect(validateInterchangeMap({ version: 1, groups: {} }).valid).toBe(true);
    });

    it('reports errors with a message', () => {
      const r = validateInterchangeMap({ version: 1 });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.errors.join(' ')).toMatch(/groups/i);
    });
  });

  describe('groupsToEdges', () => {
    it('flattens groups into a parent→child edge list with default provenance', () => {
      const edges = groupsToEdges({ version: 1, groups: { A: ['B', 'C'], D: ['B'] } }, 'user');
      expect(edges).toContainEqual({ parent: 'A', child: 'B', provenance: 'user' });
      expect(edges).toContainEqual({ parent: 'A', child: 'C', provenance: 'user' });
      expect(edges).toContainEqual({ parent: 'D', child: 'B', provenance: 'user' });
      expect(edges).toHaveLength(3);
    });

    it('dedupes identical edges', () => {
      const edges = groupsToEdges({ version: 1, groups: { A: ['B', 'B'] } }, 'agent');
      expect(edges).toHaveLength(1);
    });
  });

  describe('edgesToGroups', () => {
    it('round-trips an edge list back to a groups map (sorted, deduped)', () => {
      const edges: CompositionEdge[] = [
        { parent: 'A', child: 'C', provenance: 'user' },
        { parent: 'A', child: 'B', provenance: 'user' },
        { parent: 'D', child: 'B', provenance: 'agent' },
      ];
      const map = edgesToGroups(edges);
      expect(map.version).toBe(1);
      expect(map.groups.A).toEqual(['B', 'C']);
      expect(map.groups.D).toEqual(['B']);
    });

    it('is a stable round-trip groups→edges→groups', () => {
      const original = { version: 1 as const, groups: { A: ['B', 'C'], D: ['E'] } };
      const round = edgesToGroups(groupsToEdges(original, 'user'));
      expect(round.groups).toEqual(original.groups);
    });
  });

  describe('named slots (T7)', () => {
    it('preserves an optional per-edge slot through the edge list', () => {
      const edges: CompositionEdge[] = [{ parent: 'A', child: 'B', slot: 'header', provenance: 'adapter:x' }];
      const map = edgesToGroups(edges);
      // groups view is slot-agnostic; the edge retains the slot.
      expect(map.groups.A).toEqual(['B']);
      expect(edges[0].slot).toBe('header');
    });
  });
});
