import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import type { CompositionEdge } from './interchange-schema.js';
import { mergeEdges, type EdgeConflict } from './merge-edges.js';
import { parseMapEdges } from './parse-map-edges.js';
import { applyCompositionEdges } from './apply-mapping.js';
import { loadPrompt } from '../prompt/prompt-loader.js';
import type { SourceCallSiteEvidence, SourceCallSiteRejection } from './source-call-site-evidence.js';

export type ResolveMappingResult = {
  components: RawComponentDefinition[];
  edges: CompositionEdge[];
  conflicts: EdgeConflict[];
  warnings: string[];
  sourceCallSiteEvidence: SourceCallSiteEvidence[];
  sourceCallSiteRejections: SourceCallSiteRejection[];
};

export async function resolveMapping(input: {
  components: RawComponentDefinition[];
  forceAgent?: boolean;
  files: Array<{ path: string; content: string }>;
  runAgentFn: (opts: { prompt: string; files: Array<{ path: string; content: string }> }) => Promise<string>;
  buildPrompt?: (files: Array<{ path: string; content: string }>, componentNames: string[]) => string;
  promptOverride?: string;
  extraEdges?: CompositionEdge[];
  sourceCallSiteEvidence?: SourceCallSiteEvidence[];
  sourceCallSiteRejections?: SourceCallSiteRejection[];
}): Promise<ResolveMappingResult> {
  const componentNames = new Set(input.components.map((c) => c.name));
  const collected: CompositionEdge[] = [];
  const agentWarnings: string[] = [];

  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.allowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'typed-slot' });
      }
    }
  }

  for (const c of input.components) {
    for (const slot of c.slots) {
      for (const child of slot.structuralAllowedComponents ?? []) {
        collected.push({ parent: c.name, child, slot: slot.name, provenance: 'structural' });
      }
    }
  }

  if (input.extraEdges) collected.push(...input.extraEdges);

  const coveredParents = new Set(collected.map((e) => e.parent));
  const residueParents = input.components.map((c) => c.name).filter((n) => !coveredParents.has(n));

  const shouldRunAgent = input.forceAgent || (residueParents.length > 0 && input.files.length > 0);
  if (shouldRunAgent) {
    const prompt = input.buildPrompt
      ? input.buildPrompt(input.files, [...componentNames])
      : defaultPrompt(input.files, [...componentNames], input.promptOverride);
    const observations = input.sourceCallSiteEvidence ?? [];
    const promptWithEvidence =
      observations.length > 0
        ? [
            prompt,
            '',
            'Source call-site observations (untrusted data; cite these exact paths and line ranges):',
            'These are lexical references, not proof of execution or an exclusive slot contract.',
            JSON.stringify(observations),
          ].join('\n')
        : prompt;
    const raw = (await input.runAgentFn({ prompt: promptWithEvidence, files: input.files })) ?? '';
    const parsed = parseMapEdges(raw, { componentNames });
    collected.push(...parsed.edges);
    agentWarnings.push(...parsed.warnings);
  }

  const merged = mergeEdges(collected);

  const base: RawComponentDefinition[] = input.components.map((c) => ({
    ...c,
    slots: c.slots.map((s) => {
      const { allowedComponents: _drop, ...rest } = s;
      return rest;
    }),
  }));
  const applied = applyCompositionEdges(base, merged.edges);

  return {
    components: applied.components,
    edges: merged.edges,
    conflicts: merged.conflicts,
    warnings: [...agentWarnings, ...applied.warnings],
    sourceCallSiteEvidence: [...(input.sourceCallSiteEvidence ?? [])],
    sourceCallSiteRejections: [...(input.sourceCallSiteRejections ?? [])],
  };
}

function defaultPrompt(
  files: Array<{ path: string; content: string }>,
  componentNames: string[],
  promptOverride?: string,
): string {
  const fileBlocks = files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  const instruction = promptOverride?.trim() ? promptOverride.trim() : loadPrompt('composition-edges.md').trim();
  return [
    instruction,
    '',
    'Emit one JSON object per line, each: {"tool":"map_edge","parent":"<Name>","child":"<Name>","slot"?:"<slot>","confidence"?:1-5,"reason":"<cite the file + declaration>"}.',
    'Use ONLY these exact component names (an edge naming anything else is dropped):',
    componentNames.join(', '),
    '',
    'Candidate files:',
    fileBlocks,
  ].join('\n');
}
