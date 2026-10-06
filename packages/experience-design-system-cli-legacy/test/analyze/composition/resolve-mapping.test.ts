import { describe, it, expect } from 'vitest';
import { resolveMapping } from '../../../src/analyze/composition/resolve-mapping.js';
import type { SourceCallSiteEvidence } from '../../../src/analyze/composition/source-call-site-evidence.js';
import type { RawComponentDefinition, RawSlotDefinition } from '../../../src/types.js';

function comp(name: string, slots: RawSlotDefinition[] = []): RawComponentDefinition {
  return { name, source: '', framework: 'react', props: [], slots };
}
const dslot = (allowed?: string[]): RawSlotDefinition => ({
  name: 'children',
  isDefault: true,
  ...(allowed ? { allowedComponents: allowed } : {}),
});
const callSite = (parent: string, child: string, slot?: string): SourceCallSiteEvidence => ({
  parent,
  child,
  ...(slot ? { slot } : {}),
  sourcePath: 'src/Page.tsx',
  startLine: 3,
  endLine: 5,
  excerpt: `<${child} />`,
  kind: 'jsx-render',
});

const COMPONENTS = [comp('SectionTab', [dslot()]), comp('Section3Up'), comp('CaseStudyCard')];

describe('resolveMapping (ranked edge acquisition)', () => {
  it('no sources → returns components unchanged with no edges', () => {
    const res = resolveMapping({ components: COMPONENTS });
    expect(res.edges).toHaveLength(0);
    expect(res.components).toHaveLength(COMPONENTS.length);
  });

  describe('call-site provenance', () => {
    it('turns cited call sites into call-site edges and applies them', () => {
      const res = resolveMapping({
        components: COMPONENTS,
        sourceCallSiteEvidence: [callSite('SectionTab', 'Section3Up'), callSite('Section3Up', 'CaseStudyCard')],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({
          parent: 'SectionTab',
          child: 'Section3Up',
          provenance: 'call-site',
          citation: { sourcePath: 'src/Page.tsx', startLine: 3, endLine: 5 },
        }),
        expect.objectContaining({ parent: 'Section3Up', child: 'CaseStudyCard', provenance: 'call-site' }),
      ]);
      expect(res.components.find((c) => c.name === 'SectionTab')!.slots[0].allowedComponents).toEqual(['Section3Up']);
    });

    it('never invents an edge that has no call site', () => {
      const res = resolveMapping({
        components: COMPONENTS,
        sourceCallSiteEvidence: [callSite('SectionTab', 'Section3Up')],
      });
      expect(res.edges.map((e) => `${e.parent}->${e.child}`)).toEqual(['SectionTab->Section3Up']);
      expect(res.components.find((c) => c.name === 'CaseStudyCard')!.slots).toEqual([]);
    });

    it('passes through the evidence and rejections it was given', () => {
      const evidence = [callSite('SectionTab', 'Section3Up')];
      const rejections = [
        {
          parent: 'SectionTab',
          candidate: '<text>',
          sourcePath: 'src/Page.tsx',
          reason: 'text-only-child' as const,
        },
      ];
      const res = resolveMapping({
        components: COMPONENTS,
        sourceCallSiteEvidence: evidence,
        sourceCallSiteRejections: rejections,
      });
      expect(res.sourceCallSiteEvidence).toEqual(evidence);
      expect(res.sourceCallSiteRejections).toEqual(rejections);
    });

    it('drops a call site whose child is not an extracted component (warn)', () => {
      const res = resolveMapping({
        components: COMPONENTS,
        sourceCallSiteEvidence: [callSite('SectionTab', 'Ghost')],
      });
      expect(res.warnings.join(' ')).toMatch(/Ghost/);
      expect(res.components.find((c) => c.name === 'SectionTab')!.slots[0].allowedComponents ?? []).toEqual([]);
    });

    it('a declared typed-slot contract wins over a call site that places the child in another slot', () => {
      const res = resolveMapping({
        components: [
          comp('Accordion', [{ name: 'header', isDefault: false, allowedComponents: ['AccordionItem'] }, dslot()]),
          comp('AccordionItem'),
        ],
        sourceCallSiteEvidence: [callSite('Accordion', 'AccordionItem', 'children')],
      });
      expect(res.edges).toEqual([expect.objectContaining({ slot: 'header', provenance: 'typed-slot' })]);
      expect(res.conflicts).toEqual([expect.objectContaining({ winner: 'typed-slot', loser: 'call-site' })]);
    });

    it('a call site wins over manifest evidence on a slot-placement conflict', () => {
      const res = resolveMapping({
        components: [comp('Accordion', [{ name: 'header', isDefault: false }, dslot()]), comp('AccordionItem')],
        extraEdges: [{ parent: 'Accordion', child: 'AccordionItem', slot: 'children', provenance: 'manifest' }],
        sourceCallSiteEvidence: [callSite('Accordion', 'AccordionItem', 'header')],
      });
      expect(res.edges).toEqual([expect.objectContaining({ slot: 'header', provenance: 'call-site' })]);
      expect(res.conflicts).toEqual([expect.objectContaining({ winner: 'call-site', loser: 'manifest' })]);
    });
  });

  describe('structural provenance (usage evidence, no declared slot contract)', () => {
    const structuralSlot = (allowed: string[]): RawSlotDefinition => ({
      name: 'children',
      isDefault: true,
      structuralAllowedComponents: allowed,
    });

    it('surfaces as a structural edge', () => {
      const res = resolveMapping({
        components: [comp('Accordion', [structuralSlot(['AccordionItem'])]), comp('AccordionItem')],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({ parent: 'Accordion', child: 'AccordionItem', provenance: 'structural' }),
      ]);
      expect(res.components.find((c) => c.name === 'Accordion')!.slots[0].allowedComponents).toEqual(['AccordionItem']);
    });

    it('a declared typed-slot contract wins when it disagrees with structural evidence about which slot holds the same child', () => {
      const res = resolveMapping({
        components: [
          comp('Accordion', [
            { name: 'header', isDefault: false, allowedComponents: ['AccordionItem'] },
            structuralSlot(['AccordionItem']),
          ]),
          comp('AccordionItem'),
        ],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({
          parent: 'Accordion',
          child: 'AccordionItem',
          slot: 'header',
          provenance: 'typed-slot',
        }),
      ]);
      expect(res.conflicts).toEqual([
        expect.objectContaining({
          parent: 'Accordion',
          child: 'AccordionItem',
          winner: 'typed-slot',
          loser: 'structural',
        }),
      ]);
    });
  });

  describe('manifest/doc provenance ranking (extraEdges from manifest-doc-evidence.ts)', () => {
    it('manifest wins a slot-placement conflict against doc', () => {
      const res = resolveMapping({
        components: [comp('Accordion', [{ name: 'header', isDefault: false }, dslot()]), comp('AccordionItem')],
        extraEdges: [
          { parent: 'Accordion', child: 'AccordionItem', slot: 'header', provenance: 'manifest' },
          { parent: 'Accordion', child: 'AccordionItem', slot: 'children', provenance: 'doc' },
        ],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({
          parent: 'Accordion',
          child: 'AccordionItem',
          slot: 'header',
          provenance: 'manifest',
        }),
      ]);
      expect(res.conflicts).toEqual([
        expect.objectContaining({ parent: 'Accordion', child: 'AccordionItem', winner: 'manifest', loser: 'doc' }),
      ]);
    });

    it('a declared typed-slot contract wins over manifest evidence on a slot-placement conflict', () => {
      const res = resolveMapping({
        components: [
          comp('Accordion', [{ name: 'header', isDefault: false, allowedComponents: ['AccordionItem'] }, dslot()]),
          comp('AccordionItem'),
        ],
        extraEdges: [{ parent: 'Accordion', child: 'AccordionItem', slot: 'children', provenance: 'manifest' }],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({
          parent: 'Accordion',
          child: 'AccordionItem',
          slot: 'header',
          provenance: 'typed-slot',
        }),
      ]);
      expect(res.conflicts).toEqual([expect.objectContaining({ winner: 'typed-slot', loser: 'manifest' })]);
    });

    it('doc-provenance evidence is applied on its own', () => {
      const res = resolveMapping({
        components: [comp('Accordion', [dslot()]), comp('AccordionItem')],
        extraEdges: [{ parent: 'Accordion', child: 'AccordionItem', provenance: 'doc' }],
      });
      expect(res.edges).toEqual([
        expect.objectContaining({ parent: 'Accordion', child: 'AccordionItem', provenance: 'doc' }),
      ]);
    });
  });

  describe('precedence: code slots survive with no other source', () => {
    it('passes code slots through', () => {
      const withCode = [comp('A', [dslot(['B'])]), comp('B')];
      const res = resolveMapping({ components: withCode });
      expect(res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents).toEqual(['B']);
      expect(res.edges.find((e) => e.parent === 'A')!.provenance).toBe('typed-slot');
    });

    it('code and call sites union when disjoint (different children)', () => {
      const withCode = [comp('A', [dslot(['B'])]), comp('B'), comp('C')];
      const res = resolveMapping({ components: withCode, sourceCallSiteEvidence: [callSite('A', 'C', 'children')] });
      const allowed = res.components.find((c) => c.name === 'A')!.slots[0].allowedComponents!.sort();
      expect(allowed).toEqual(['B', 'C']);
    });
  });
});
