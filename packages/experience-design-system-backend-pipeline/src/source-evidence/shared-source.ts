import type { SourceCapture } from '../steps/extraction/index.js';
import type {
  SharedSource,
  SharedSourceFile,
  BoundSourceFile,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import type { SessionSourceEnvelope } from '../persistence/src/session/repositories/db.js';

export function findSourceOwnerFile(
  capture: SourceCapture,
  componentId: string,
  sourcePath?: string | null,
): SourceCapture['files'][number] | undefined {
  return (
    capture.files.find((file) =>
      file.componentRefs.some((ref) => ref.componentId === componentId && ref.roles.includes('definition')),
    ) ??
    capture.files.find((file) =>
      file.componentRefs.some(
        (ref) =>
          ref.componentId === componentId && (ref.roles.includes('binding') || ref.roles.includes('supplied-source')),
      ),
    ) ??
    capture.files.find((file) => file.canonicalPath === sourcePath || file.displayPath === sourcePath)
  );
}

export function capturedRanges(
  file: SourceCapture['files'][number],
): Array<{ startLine: number; endLine: number; text: string }> {
  if (file.captured.kind === 'full')
    return [{ startLine: 1, endLine: file.captured.text.split('\n').length, text: file.captured.text }];
  return file.captured.kind === 'excerpts' ? file.captured.ranges : [];
}

export function projectCapturedFile(file: SourceCapture['files'][number]): SharedSourceFile {
  let displayLine = 1;
  const ranges = capturedRanges(file).map((range, index) => {
    if (index > 0) displayLine += 2;
    const projected = { startLine: range.startLine, endLine: range.endLine, displayStartLine: displayLine };
    displayLine += range.text.split('\n').length;
    return projected;
  });
  return {
    fileId: file.fileId,
    ...(file.compilerContextId ? { compilerContextId: file.compilerContextId } : {}),
    path: file.displayPath,
    canonicalPath: file.canonicalPath,
    textHash: file.textHash,
    content: capturedRanges(file)
      .map((range) => range.text)
      .join('\n/* … */\n'),
    ranges,
    partial: file.captured.kind !== 'full',
    coverage:
      file.captured.kind === 'full'
        ? 'complete-within-declared-bound'
        : file.captured.kind === 'excerpts'
          ? 'partial'
          : 'unavailable',
    roles: [...file.roles],
    componentRefs: file.componentRefs.map((ref) => ({ ...ref, roles: [...ref.roles] })),
  };
}

/** Build only from the completed saved envelope, including admitted incoming references. */
export function buildSharedSource(envelope: SessionSourceEnvelope, componentIds?: readonly string[]): SharedSource {
  const { capture } = envelope;
  const wanted = componentIds ? new Set(componentIds) : undefined;
  const selected = new Set(
    capture.files
      .filter((file) => !wanted || file.componentRefs.some((ref) => wanted.has(ref.componentId)))
      .map((file) => file.fileId),
  );
  for (const value of envelope.observations.referenceIndexes ?? []) {
    const index = value as import('../steps/extraction/index.js').SourceReferenceIndex;
    for (const reference of index.references)
      for (const file of capture.files)
        if (file.canonicalPath === reference.location.canonicalPath) selected.add(file.fileId);
  }
  // Follow captured outgoing edges; no disk discovery or reverse package expansion.
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of capture.resolution)
      if (selected.has(edge.fromFileId) && edge.targetFileId && !selected.has(edge.targetFileId)) {
        selected.add(edge.targetFileId);
        changed = true;
      }
  }
  const contextIds = new Set(
    capture.files.filter((file) => selected.has(file.fileId)).map((file) => file.compilerContextId),
  );
  const compilerContexts = capture.compilerContexts?.filter((context) => contextIds.has(context.contextId));
  for (const context of compilerContexts ?? []) for (const config of context.configFiles) selected.add(config.fileId);
  const files = capture.files.filter((file) => selected.has(file.fileId)).map(projectCapturedFile);
  const owners = new Map<string, { componentId: string; name: string }>();
  for (const file of capture.files)
    for (const ref of file.componentRefs) if (!wanted || wanted.has(ref.componentId)) owners.set(ref.componentId, ref);
  const components = [...owners.values()]
    .sort((a, b) => a.componentId.localeCompare(b.componentId))
    .map((owner) => {
      const definition = capture.files.find((file) =>
        file.componentRefs.some((ref) => ref.componentId === owner.componentId && ref.roles.includes('definition')),
      );
      const binding = capture.files.find((file) =>
        file.componentRefs.some(
          (ref) =>
            ref.componentId === owner.componentId &&
            (ref.roles.includes('binding') || ref.roles.includes('supplied-source')),
        ),
      );
      const refs = files.flatMap((file) =>
        (file.componentRefs ?? [])
          .filter((ref) => ref.componentId === owner.componentId)
          .flatMap((ref) =>
            ref.roles.map((role) => ({ fileId: file.fileId, path: file.path, role, partial: file.partial })),
          ),
      );
      const reached = new Set(refs.map((ref) => ref.fileId));
      for (let changed = true; changed; ) {
        changed = false;
        for (const edge of capture.resolution)
          if (reached.has(edge.fromFileId) && edge.targetFileId && !reached.has(edge.targetFileId)) {
            reached.add(edge.targetFileId);
            changed = true;
            const file = files.find((file) => file.fileId === edge.targetFileId);
            if (file) refs.push({ fileId: file.fileId, path: file.path, role: 'import', partial: file.partial });
          }
      }
      return {
        componentId: owner.componentId,
        component: owner.name,
        source: (definition ?? binding)?.displayPath ?? '',
        refs,
      };
    });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    captureId: capture.captureId,
    captureDigest: capture.digest,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.digest,
    sessionId: envelope.sessionId,
    extractionStepId: envelope.extractionStepId,
    coverage: capture.coverage,
    promptCoverage:
      capture.coverage === 'complete-within-declared-bound' && files.some((file) => file.partial)
        ? 'partial'
        : capture.coverage,
    extractionByteBinding: envelope.extractionByteBinding,
    files,
    ...(compilerContexts ? { compilerContexts: structuredClone(compilerContexts) } : {}),
    components,
    omittedFiles: 0,
    omittedRanges: 0,
    omittedComponents: 0,
    diagnostics: capture.diagnostics,
    observations: envelope.observations,
    ...(capture.inventory
      ? {
          inventory: {
            ...capture.inventory,
            files: capture.inventory.files.map(({ text: _text, ...file }) => file),
            sourceMaps: capture.inventory.sourceMaps.map((map) => ({
              ...map,
              sources: map.sources.map(({ text: _text, ...source }) => source),
            })),
          },
        }
      : {}),
  };
}

const SOURCE_HEADER =
  '### Shared source evidence\n\nFiles occur once; roles are lexical observations, not runtime execution proof. Preserve declared alternatives, domain, defaults and requiredness; callers cannot narrow them. Missing or omitted source is unknown.\n```json\n';
export function renderSharedSource(source: SharedSource): string {
  return `${SOURCE_HEADER}${JSON.stringify(source)}\n\`\`\``;
}

function assertByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new Error('Source projection byte bound must be a non-negative safe integer');
}

/** Count the exact consumer serialization, including its source-section header. */
export function projectSharedSource(source: SharedSource, maxBytes: number): SharedSource {
  assertByteLimit(maxBytes);
  maxBytes = Math.min(maxBytes, source.projectionBounds?.maxBytes ?? maxBytes);
  const projected: SharedSource = structuredClone(source);
  const size = measuredProjection(projected, maxBytes, () => renderSharedSource(projected));
  fitProjection(
    projected,
    maxBytes,
    size,
    (file) => {
      const lines = file.content.split('\n');
      return (file.ranges ?? []).map((range) => ({
        startLine: range.startLine,
        endLine: range.endLine,
        text: lines
          .slice(range.displayStartLine - 1, range.displayStartLine + range.endLine - range.startLine)
          .join('\n'),
      }));
    },
    (file, ranges) => {
      file.content = ranges.map((range) => range.text).join('\n/* … */\n');
      let line = 1;
      file.ranges = ranges.map((range, index) => {
        if (index > 0) line += 2;
        const mapped = { startLine: range.startLine, endLine: range.endLine, displayStartLine: line };
        line += range.text.split('\n').length;
        return mapped;
      });
      file.partial = true;
      file.coverage = 'partial';
    },
  );
  return projected;
}

type ProjectionMetadata = Pick<
  SharedSource,
  | 'components'
  | 'promptCoverage'
  | 'omittedFiles'
  | 'omittedRanges'
  | 'omittedComponents'
  | 'omittedDiagnostics'
  | 'omittedObservations'
  | 'diagnostics'
  | 'observations'
  | 'compilerContexts'
  | 'omittedCompilerContexts'
  | 'inventory'
  | 'omittedInventory'
>;
type TextRange = { startLine: number; endLine: number; text: string };

function measuredProjection(
  source: { projectionBounds?: { maxBytes: number; usedBytes: number } },
  maxBytes: number,
  serialize: () => string,
): () => number {
  source.projectionBounds = { maxBytes, usedBytes: 0 };
  return () => {
    // Count this receipt too; its decimal byte count converges once the digit width is stable.
    for (;;) {
      const bytes = Buffer.byteLength(serialize(), 'utf8');
      if (source.projectionBounds!.usedBytes === bytes) return bytes;
      source.projectionBounds!.usedBytes = bytes;
    }
  };
}

/** One omission policy for source bodies, reference receipts and irreducible metadata. */
function fitProjection<File extends { fileId?: string; path: string }>(
  source: Omit<ProjectionMetadata, 'components'> & { components?: SharedSource['components']; files: File[] },
  maxBytes: number,
  size: () => number,
  rangesFor: (file: File) => TextRange[],
  setRanges: (file: File, ranges: TextRange[]) => void,
): void {
  // Additive metadata has its own omission receipts when the existing body projection cannot fit it.
  if (size() > maxBytes && source.inventory !== undefined) {
    source.inventory = undefined;
    source.omittedInventory = (source.omittedInventory ?? 0) + 1;
    source.promptCoverage = 'partial';
  }
  while (size() > maxBytes && source.observations?.referenceIndexes?.length) {
    source.observations.referenceIndexes.pop();
    source.omittedObservations = (source.omittedObservations ?? 0) + 1;
    source.promptCoverage = 'partial';
  }
  while (size() > maxBytes && source.files.length) {
    const file = source.files.at(-1)!;
    const ranges = rangesFor(file);
    const lines = ranges.map((range) => ({ ...range, lines: range.text.split('\n') }));
    const totalLines = lines.reduce((total, range) => total + range.lines.length, 0);
    source.promptCoverage = 'partial';
    source.omittedRanges = (source.omittedRanges ?? 0) + ranges.length;
    for (const owner of source.components ?? [])
      for (const ref of owner.refs)
        if (ref.fileId ? ref.fileId === file.fileId : ref.path === file.path) ref.partial = true;
    // Keep only complete original lines; never split a UTF-8 sequence or invent line coordinates.
    const prefix = (count: number): TextRange[] => {
      const kept: TextRange[] = [];
      for (const range of lines) {
        const take = Math.min(count, range.lines.length);
        if (take > 0)
          kept.push({
            startLine: range.startLine,
            endLine: range.startLine + take - 1,
            text: range.lines.slice(0, take).join('\n'),
          });
        count -= take;
      }
      return kept;
    };
    let low = 0,
      high = Math.max(0, totalLines - 1);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      setRanges(file, prefix(mid));
      if (size() <= maxBytes) low = mid;
      else high = mid - 1;
    }
    if (low > 0) {
      setRanges(file, prefix(low));
      if (size() <= maxBytes) break;
    }
    source.files.pop();
    source.omittedFiles = (source.omittedFiles ?? 0) + 1;
  }
  if (size() > maxBytes) {
    source.omittedObservations =
      (source.omittedObservations ?? 0) +
      (source.observations?.accepted.length ?? 0) +
      (source.observations?.rejected.length ?? 0) +
      (source.observations?.referenceIndexes?.length ?? 0) +
      (source.observations?.callerCoverage ? 1 : 0);
    source.omittedDiagnostics = (source.omittedDiagnostics ?? 0) + (source.diagnostics?.length ?? 0);
    source.observations = { accepted: [], rejected: [] };
    source.diagnostics = [];
    source.promptCoverage = 'partial';
  }
  if (size() > maxBytes && source.inventory !== undefined) {
    source.inventory = undefined;
    source.omittedInventory = (source.omittedInventory ?? 0) + 1;
    source.promptCoverage = 'partial';
  }
  while (size() > maxBytes && source.compilerContexts?.length) {
    source.compilerContexts.pop();
    source.omittedCompilerContexts = (source.omittedCompilerContexts ?? 0) + 1;
    source.promptCoverage = 'partial';
  }
  while (size() > maxBytes && source.components?.length) {
    source.components.pop();
    source.omittedComponents = (source.omittedComponents ?? 0) + 1;
    source.promptCoverage = 'partial';
  }
  if (size() > maxBytes) throw new Error('Source identity metadata exceeds prompt bound');
}

/** Assurance keeps original canonical ranges; this adapter uses the same saved index. */
export function projectExplorationSource(
  envelope: SessionSourceEnvelope,
  maxBytes: number,
  compilerDiagnostics?: unknown,
): ExplorationSourceInput {
  assertByteLimit(maxBytes);
  maxBytes = Math.min(maxBytes, envelope.capture.bounds.limits.maxPromptBytes);
  const index = buildSharedSource(envelope);
  const result: ExplorationSourceInput = {
    captureId: envelope.capture.captureId,
    captureDigest: envelope.capture.digest,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.digest,
    coverage: envelope.capture.coverage,
    promptCoverage: envelope.capture.coverage,
    extractionByteBinding: envelope.extractionByteBinding,
    files: envelope.capture.files.map((file) => ({
      fileId: file.fileId,
      ...(file.compilerContextId ? { compilerContextId: file.compilerContextId } : {}),
      path: file.canonicalPath,
      textHash: file.textHash,
      ranges: capturedRanges(file),
      coverage:
        file.captured.kind === 'full'
          ? 'complete-within-declared-bound'
          : file.captured.kind === 'excerpts'
            ? 'partial'
            : 'unavailable',
      roles: [...file.roles],
      componentRefs: file.componentRefs.map((ref) => ({ ...ref, roles: [...ref.roles] })),
    })),
    components: index.components,
    ...(index.compilerContexts ? { compilerContexts: index.compilerContexts } : {}),
    omittedFiles: 0,
    diagnostics: [
      ...envelope.capture.diagnostics,
      ...(compilerDiagnostics ? [{ kind: 'compiler-run', diagnostics: compilerDiagnostics }] : []),
    ],
    observations: envelope.observations,
    ...(index.inventory ? { inventory: index.inventory } : {}),
  };
  return projectExplorationSourceInput(result, maxBytes);
}

/** Reapply the saved source bound after a consumer filters its advisory metadata. */
export function projectExplorationSourceInput(
  source: ExplorationSourceInput,
  maxBytes: number,
): ExplorationSourceInput {
  assertByteLimit(maxBytes);
  maxBytes = Math.min(maxBytes, source.projectionBounds?.maxBytes ?? maxBytes);
  const result = structuredClone(source);
  const size = measuredProjection(result, maxBytes, () => JSON.stringify(result));
  fitProjection<BoundSourceFile>(
    result,
    maxBytes,
    size,
    (file) => file.ranges,
    (file, ranges) => {
      file.ranges = ranges;
      file.coverage = 'partial';
    },
  );
  if (result.files.some((file) => file.coverage !== 'complete-within-declared-bound'))
    result.promptCoverage = 'partial';
  size();
  return result;
}
