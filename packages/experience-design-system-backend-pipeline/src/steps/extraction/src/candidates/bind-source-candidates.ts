import type { SourceClosureCaptureBinding, SourceClosureEvidence } from '../../source-closure/source-evidence.js';
import { mapSourceClosureLocations } from '../../source-closure/source-evidence.js';
import type { RawComponentDefinition } from '../types/component.js';
import { mapSourceObservationLocations } from '../component-facts/map-source-observation-locations.js';
import type { ComponentFacts } from '../types/component-facts.js';
import type {
  ExtractionDiagnostics,
  SourceCandidate,
  SourceCandidateSource,
  SourceFactLocation,
  SourceTypeGraph,
} from './types.js';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export interface CapturedSourceHash {
  canonicalPath: string;
  textHash: string | null;
}

function bindLocation(
  location: SourceFactLocation | null,
  capturedByPath: ReadonlyMap<string, string | null>,
): SourceFactLocation | null {
  if (!location?.canonicalPath || !location.textHash) {
    return location ? { ...location, binding: 'unavailable' } : null;
  }
  const capturedHash = capturedByPath.get(canonicalPath(location.canonicalPath));
  if (capturedHash === undefined) return { ...location, binding: 'unavailable' };
  if (capturedHash === null) return { ...location, binding: 'unverified' };
  return { ...location, binding: capturedHash === location.textHash ? 'verified' : 'changed' };
}

function canonicalPath(path: string): string {
  let existing = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    suffix.unshift(basename(existing));
    existing = parent;
  }
  try {
    return resolve(realpathSync.native(existing), ...suffix);
  } catch {
    return resolve(path);
  }
}
export { canonicalPath as canonicalSourceFactPath };

function bindGraph(graph: SourceTypeGraph, capturedByPath: ReadonlyMap<string, string | null>): SourceTypeGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      declarations: node.declarations.map((declaration) => bindLocation(declaration, capturedByPath)!),
      ...(node.fields
        ? {
            fields: node.fields.map((field) => ({
              ...field,
              ...(field.declarations
                ? { declarations: field.declarations.map((declaration) => bindLocation(declaration, capturedByPath)!) }
                : {}),
            })),
          }
        : {}),
    })),
  };
}

function bindCandidate(
  candidate: SourceCandidate,
  capturedByPath: ReadonlyMap<string, string | null>,
): SourceCandidate {
  return {
    ...candidate,
    facts: candidate.facts
      ? {
          ...candidate.facts,
          ...(candidate.facts.sourceGraph
            ? {
                sourceGraph: bindGraph(candidate.facts.sourceGraph, capturedByPath),
              }
            : {}),
          declarations: candidate.facts.declarations.map((location) => bindLocation(location, capturedByPath)!),
          sourceDefault: candidate.facts.sourceDefault
            ? {
                ...candidate.facts.sourceDefault,
                location: bindLocation(candidate.facts.sourceDefault.location, capturedByPath),
                ...(candidate.facts.sourceDefault.dependencies
                  ? {
                      dependencies: candidate.facts.sourceDefault.dependencies.map(
                        (item) => bindLocation(item, capturedByPath)!,
                      ),
                    }
                  : {}),
              }
            : null,
        }
      : null,
    observations: candidate.observations.map((observation) => ({
      ...observation,
      location: bindLocation(observation.location, capturedByPath),
      ...(observation.syntax
        ? {
            syntax: {
              ...observation.syntax,
              default: {
                ...observation.syntax.default,
                locations: observation.syntax.default.locations.map(
                  (location) => bindLocation(location, capturedByPath)!,
                ),
              },
              typeLocations: observation.syntax.typeLocations.map(
                (location) => bindLocation(location, capturedByPath)!,
              ),
            },
          }
        : {}),
      ...(observation.fact
        ? {
            fact: {
              ...observation.fact,
              ...(observation.fact.sourceGraph
                ? {
                    sourceGraph: bindGraph(observation.fact.sourceGraph, capturedByPath),
                  }
                : {}),
              declarations: observation.fact.declarations.map((location) => bindLocation(location, capturedByPath)!),
              sourceDefault: observation.fact.sourceDefault
                ? {
                    ...observation.fact.sourceDefault,
                    location: bindLocation(observation.fact.sourceDefault.location, capturedByPath),
                    ...(observation.fact.sourceDefault.dependencies
                      ? {
                          dependencies: observation.fact.sourceDefault.dependencies.map(
                            (item) => bindLocation(item, capturedByPath)!,
                          ),
                        }
                      : {}),
                  }
                : null,
            },
          }
        : {}),
    })),
  };
}

function bindSource(candidateSource: SourceCandidateSource, capturedByPath: ReadonlyMap<string, string | null>) {
  return {
    ...candidateSource,
    candidates: candidateSource.candidates?.map((candidate) => bindCandidate(candidate, capturedByPath)) ?? null,
  };
}

function bindComponentFacts(facts: ComponentFacts, captured: ReadonlyMap<string, string | null>): ComponentFacts {
  const bindObservation = <T extends { location: SourceFactLocation | null }>(observation: T): T => ({
    ...observation,
    location: bindLocation(observation.location, captured),
  });
  return {
    ...facts,
    ...(facts.sourceObservations
      ? {
          sourceObservations: mapSourceObservationLocations(
            facts.sourceObservations,
            (location) => bindLocation(location, captured)!,
          ),
        }
      : {}),
    ...(facts.renderables ? { renderables: facts.renderables.map(bindObservation) } : {}),
    ...(facts.members ? { members: facts.members.map(bindObservation) } : {}),
    ...(facts.childFilters ? { childFilters: facts.childFilters.map(bindObservation) } : {}),
    ...(facts.requiresParent ? { requiresParent: facts.requiresParent.map(bindObservation) } : {}),
    ...(facts.nonStatic ? { nonStatic: facts.nonStatic.map(bindObservation) } : {}),
    ...(facts.origin ? { origin: bindObservation(facts.origin) } : {}),
    ...(facts.referencedOrigins
      ? {
          referencedOrigins: facts.referencedOrigins.map((reference) => ({
            ...bindObservation(reference),
            origin: bindObservation(reference.origin),
          })),
        }
      : {}),
  };
}

/** Recompute binding from accepted captured hashes, independently from summary convergence. */
export function bindSourceClosureToCapture(
  evidence: SourceClosureEvidence,
  capturedFiles: readonly CapturedSourceHash[],
  identity: SourceClosureCaptureBinding | null = null,
): SourceClosureEvidence {
  const captured = new Map(capturedFiles.map((file) => [canonicalPath(file.canonicalPath), file.textHash]));
  for (const file of capturedFiles)
    if (!captured.has(resolve(file.canonicalPath))) captured.set(resolve(file.canonicalPath), file.textHash);
  return {
    ...mapSourceClosureLocations(evidence, (location) => bindLocation(location, captured)!),
    captureBinding: identity,
  };
}
/** Bind compiler-read hashes to the exact files in the accepted saved capture. */
export function bindSourceCandidatesToCapture<T extends RawComponentDefinition>(
  components: readonly T[],
  capturedFiles: readonly CapturedSourceHash[],
  identity: SourceClosureCaptureBinding | null = null,
): T[] {
  const capturedByPath = new Map(capturedFiles.map((file) => [canonicalPath(file.canonicalPath), file.textHash]));
  const normalizedCaptured = new Map(capturedFiles.map((file) => [resolve(file.canonicalPath), file.textHash]));
  for (const [path, hash] of normalizedCaptured) {
    if (!capturedByPath.has(path)) capturedByPath.set(path, hash);
  }
  return components.map((component) => ({
    ...component,
    ...(component.componentFacts
      ? {
          componentFacts: {
            ...bindComponentFacts(component.componentFacts, capturedByPath),
            ...(component.componentFacts.sourceClosure
              ? {
                  sourceClosure: bindSourceClosureToCapture(
                    component.componentFacts.sourceClosure,
                    capturedFiles,
                    identity,
                  ),
                }
              : {}),
          },
        }
      : {}),
    ...(component.sourceCandidates !== undefined
      ? { sourceCandidates: component.sourceCandidates.map((candidate) => bindCandidate(candidate, capturedByPath)) }
      : {}),
    ...(component.sourceCandidateSources !== undefined
      ? { sourceCandidateSources: component.sourceCandidateSources.map((item) => bindSource(item, capturedByPath)) }
      : {}),
  }));
}

/** Bind observed read receipts without upgrading files absent from the saved capture. */
export function bindCompilerReadsToCapture(
  diagnostics: ExtractionDiagnostics | undefined,
  capturedFiles: readonly CapturedSourceHash[],
): ExtractionDiagnostics | undefined {
  if (!diagnostics) return undefined;
  const captured = new Map(capturedFiles.map((file) => [canonicalPath(file.canonicalPath), file.textHash]));
  return {
    ...diagnostics,
    ...(diagnostics.reads
      ? {
          reads: diagnostics.reads.map((read) => {
            const saved = captured.get(canonicalPath(read.path));
            const binding =
              read.outcome !== 'read' || !read.textHash
                ? 'unavailable'
                : saved === undefined
                  ? 'unavailable'
                  : saved === null
                    ? 'unverified'
                    : saved === read.textHash
                      ? 'verified'
                      : 'changed';
            return { ...read, binding };
          }),
        }
      : {}),
  };
}
