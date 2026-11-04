import type { PromptOptions } from '../../../../../agents/types/prompts.js';
import { buildPrompt } from '../../../../../agents/prompts/build-prompt.js';
import { parseStrictJson } from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { buildComponentEvidence } from '../../../../../agents/prompts/helpers/build-component-evidence.js';

/** Detailed observations remain in the invocation artifact, separate from the decision summary. */
export function summarizeGenerationComponent(component: RawComponentDefinition, properties?: ReadonlySet<string>) {
  return {
    name: component.name,
    source: component.sourcePath ?? component.source,
    factSchemaVersion: component.factSchemaVersion ?? null,
    sourceEvidenceReadStatus: component.sourceEvidenceReadStatus ?? 'caller-provided',
    componentEvidenceReadStatus: component.componentEvidenceReadStatus ?? 'caller-provided',
    slots: component.slots,
    properties: component.sourceCandidates
      ?.filter((candidate) => !properties || properties.has(candidate.name))
      .map(({ observations, ...candidate }) => ({ ...candidate, observationCount: observations.length })),
    componentFacts: component.componentFacts
      ? {
          sourceObservations: {
            coverage: component.componentFacts.sourceObservations?.coverage ?? 'unavailable',
            omissions: component.componentFacts.sourceObservations?.omissions ?? [],
            observationCount: component.componentFacts.sourceObservations?.observations.length ?? 0,
            detailedObservations: 'Inspect component.componentFacts in the immutable evidence artifact',
          },
        }
      : null,
    alternateSourceCount: component.sourceCandidateSources?.length ?? 0,
  };
}

function compilerSummary(inline: string | undefined, component: RawComponentDefinition): string {
  let status: unknown = { readiness: 'caller-provided' };
  let readiness: 'ready' | 'caller-provided' | 'unavailable' = 'caller-provided';
  if (inline) {
    try {
      const full = parseStrictJson(inline) as Record<string, unknown>;
      readiness = full.readiness === 'ready' || full.readiness === 'caller-provided' ? full.readiness : 'unavailable';
      const compiler = full.compilerEvidence as Record<string, unknown> | undefined;
      const diagnostics = compiler?.runDiagnostics as Record<string, unknown> | undefined;
      status = {
        readiness: full.readiness,
        reason: full.reason,
        diagnosticsStatus: compiler?.status,
        coverage: diagnostics?.coverage,
        detailedDiagnostics: 'Preserved in the complete context artifact',
      };
    } catch {
      readiness = 'unavailable';
      status = { readiness: 'unknown', reason: 'Compiler context could not be summarized; inspect complete context' };
    }
  }
  const evidence = buildComponentEvidence([component], readiness)[0]!;
  const preview = evidence.fieldProjectionPreview;
  const closure = evidence.closureFactProjection;
  return JSON.stringify({
    status,
    component: summarizeGenerationComponent(component),
    evidence: {
      status: evidence.status,
      ...(evidence.fieldSemanticsPolicy ? { fieldSemanticsPolicy: evidence.fieldSemanticsPolicy } : {}),
      ...(preview
        ? {
            fieldProjectionPreview: {
              mode: preview.mode,
              replayStatus: preview.replayStatus,
              uncoveredFields: preview.uncoveredFields,
              fieldCount: preview.fields.length,
            },
          }
        : {}),
      ...(closure
        ? {
            closureFactProjection: {
              mode: closure.mode,
              runtimeApplicability: closure.runtimeApplicability,
              status: closure.status,
              reason: closure.reason,
              sourceBinding: closure.sourceBinding,
              closureStatus: closure.closureStatus,
              usedRecords: closure.usedRecords,
              omittedRecords: closure.omittedRecords,
            },
          }
        : {}),
      detailedEvidence: 'Inspect the complete compiler component-facts entry in the immutable evidence artifact',
    },
  });
}

export async function buildGenerationPrompt(options: PromptOptions, component: RawComponentDefinition) {
  const fullContextPrompt = await buildPrompt(options);
  const owner = options.sharedSource?.components.find(
    (item) => item.component === component.name && item.source === component.source,
  );
  const definitionIds = new Set(
    owner?.refs
      .filter((ref) => ['definition', 'binding', 'supplied-source'].includes(ref.role))
      .map((ref) => ref.fileId),
  );
  const source = options.sharedSource;
  const files = source?.files.filter(
    (file) =>
      (file.fileId !== undefined && definitionIds.has(file.fileId)) ||
      file.canonicalPath === (component.sourcePath ?? component.source) ||
      file.path === component.source,
  );
  const scopedSource = source
    ? {
        ...source,
        files: files ?? [],
        components: owner ? [owner] : [],
        inventory: undefined,
        diagnostics: undefined,
        observations: undefined,
        promptCoverage: 'partial' as const,
        omittedFiles: (source.omittedFiles ?? 0) + source.files.length - (files?.length ?? 0),
      }
    : undefined;
  const refs = options.componentSourceRefs
    ?.filter((ref) => ref.component === component.name)
    .map(({ siblingFiles: _siblings, ...ref }) => ref);
  const prompt = await buildPrompt({
    ...options,
    compilerEvidenceInline: compilerSummary(options.compilerEvidenceInline, component),
    sharedSource: scopedSource,
    componentSourceRefs: refs,
  });
  const dependencyIndex = source?.files.map(({ content: _content, componentRefs: _refs, ...file }) => file);
  const repairInstructions = await buildPrompt({
    skill: options.skill,
    mode: options.mode,
    outDir: options.outDir,
    skillPathOverride: options.skillPathOverride,
    skillContentOverride: options.skillContentOverride,
    componentAllowlistInline: options.componentAllowlistInline,
  });
  return {
    originalPrompt: `${prompt}\n\n## Evidence access\nThis is a component-scoped summary, not a complete source capture. Full dependencies, observations, diagnostics and original context remain in the supplied immutable context artifact. Inspect relevant facts there before making an unsupported absence, exclusion or compatibility claim. No source facts were deleted or recaptured.\n${JSON.stringify({ dependencyIndex })}`,
    fullContextPrompt,
    repairInstructions,
  };
}
