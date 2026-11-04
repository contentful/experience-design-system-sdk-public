import { expect, it } from 'vitest';
import {
  ExploreSlotEvidenceSchema,
  CDFComponentSchema,
  type SlotDecision,
} from '@contentful/experience-design-system-types';
import { projectAcceptedSlots } from '../../src/steps/exploration/src/services/project-accepted-slots.js';

const association = {
  schemaVersion: 1,
  componentId: 'surface',
  componentDeclarationId: 'declaration',
  rootSymbolId: 'parameter',
  inputName: 'supplied',
  inputPath: ['supplied'],
};
const decision = {
  name: 'Surface',
  source: '/example/Surface.tsx',
  componentId: 'surface',
  slot: 'region',
  state: 'open',
  allowedComponents: [],
  evidence: [],
  coverage: 7,
  realVotes: 7,
  sourceInput: association,
} as SlotDecision;
it('projects exact accepted source ownership while retaining unlinked properties', () => {
  const projected = projectAcceptedSlots(
    {
      $type: 'component',
      $properties: {
        supplied: { $type: 'richtext', $category: 'content' },
        separate: { $type: 'string', $category: 'content', $default: 'original' },
      },
    },
    [decision],
  );
  expect(projected.$properties).not.toHaveProperty('supplied');
  expect(projected.$properties.separate?.$default).toBe('original');
  expect(projected.$slots?.region).toHaveProperty('$sourceInput', association);
  expect(CDFComponentSchema.safeParse(projected).success).toBe(true);
});
it('rejects blank slots, duplicate source owners and explicit property conflicts', () => {
  expect(ExploreSlotEvidenceSchema.safeParse({ name: '   ', isRealSlot: true }).success).toBe(false);
  const entry = { $type: 'component' as const, $properties: {} };
  expect(() => projectAcceptedSlots(entry, [decision, { ...decision, slot: 'other' }])).toThrow(/owner|input/i);
  expect(() => projectAcceptedSlots(entry, [{ ...decision, slot: ' ' }])).toThrow(/blank|name/i);
});
it('shared complete CDF validation rejects duplicate and conflicting source owners', () => {
  expect(
    CDFComponentSchema.safeParse({
      $type: 'component',
      $properties: {},
      $slots: { first: { $sourceInput: association }, second: { $sourceInput: association } },
    }).success,
  ).toBe(false);
  expect(
    CDFComponentSchema.safeParse({
      $type: 'component',
      $properties: { supplied: { $type: 'string', $category: 'content', $sourceInput: association } },
      $slots: { region: { $sourceInput: association } },
    }).success,
  ).toBe(false);
});
