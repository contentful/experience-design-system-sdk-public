import { readFile } from 'node:fs/promises';
import { ModuleKind, Project, ScriptTarget } from 'ts-morph';
import type {
  ComponentExtractionResult,
  ExtractorOptions,
  ExtractorProgress,
  RawComponentDefinition,
  RawSlotDefinition,
} from '../../types/component.js';
import { computeExtractionScore, deriveNeedsReview } from '../../helpers/quality/scoring.js';
import { findComponentDecorator, hasComponentDecorator } from './helpers/find-component-decorator.js';
import { extractProps } from './helpers/props/extract-props.js';
import { readComponentMetadata } from './helpers/read-component-metadata.js';
import { extractSlots } from './helpers/slots/extract-slots.js';

export async function extractAngularComponents(
  filePaths: string[],
  onProgress?: (p: ExtractorProgress) => void,
  _opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const components: RawComponentDefinition[] = [];
  const warnings: string[] = [];
  let filesProcessed = 0;

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
      allowJs: false,
    },
  });

  for (const filePath of filePaths) {
    try {
      const source = await readFile(filePath, 'utf8');
      const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });

      for (const cls of sourceFile.getClasses()) {
        if (!hasComponentDecorator(cls)) continue;
        if (!findComponentDecorator(cls)) {
          warnings.push(
            `${filePath}: ${cls.getName() ?? '<anonymous>'} has @Component with a non-literal argument; skipped.`,
          );
          continue;
        }
        const meta = readComponentMetadata(cls, filePath);
        if (!meta) continue;

        const propsOnly = extractProps(cls, meta);
        const { props, slots } = await extractSlots(cls, meta, propsOnly);

        const partial: RawComponentDefinition = {
          name: meta.className,
          source: filePath,
          framework: 'angular',
          props,
          slots: normalizeSlots(slots),
          sourcePath: filePath,
        };
        const score = computeExtractionScore(partial);
        partial.extractionConfidence = score.confidence;
        partial.reviewReasons = score.reasons;
        partial.needsReview = deriveNeedsReview(score.confidence);

        components.push(partial);
      }

      sourceFile.forget();
    } catch (err) {
      warnings.push(`${filePath}: Angular extractor failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      filesProcessed++;
      if (onProgress) onProgress({ filesProcessed, componentsFound: components.length });
    }
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

function normalizeSlots(slots: RawSlotDefinition[]): RawSlotDefinition[] {
  let fallbackIndex = 0;
  return slots.map((slot) => {
    if (slot.name.trim()) return slot;
    const name = fallbackIndex === 0 ? 'children' : `slot_${fallbackIndex}`;
    fallbackIndex++;
    return { ...slot, name };
  });
}
