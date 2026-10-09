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

/**
 * Native Angular `.ts` extractor. Reads each file via ts-morph, walks every
 * exported class with a `@Component({...})` decorator, and emits one
 * `RawComponentDefinition` per class.
 *
 * Scope:
 *   - Props: `@Input()` decorator (incl. setter form + `{alias,required,transform}`),
 *     signal `input()` / `input.required()`, legacy `inputs: [...]` array.
 *   - Slots: `<ng-content>` tags (inline template or `templateUrl`),
 *     `contentChild()` / `contentChildren()` / `@ContentChild(X)` queries,
 *     TemplateRef-typed inputs promoted to slots.
 *   - Allowed-components: resolved from `contentChild(X)` type references
 *     when X is an imported class in the same package graph.
 *
 * Out of scope (v1):
 *   - DI-based composition (hostDirectives, provideXxxContext) — emits each
 *     sub-component as its own loose component.
 *   - `*ngProjectAs` — 0/25 real DS components used it.
 *   - Computed decorator args (identifier refs, spread) — 0/5 sampled DS
 *     components used them; the sibling adapters' React/Vue warning pattern
 *     applies if encountered.
 */
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
          // Has @Component but arg isn't an object literal — surface and skip.
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

      // Release memory for the next file.
      sourceFile.deleteImmediatelySync();
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

/**
 * Ensure every slot has a non-empty `name`. The pipeline's validator treats
 * empty slot names as warnings (not errors), but the convention is: if we
 * can't name it, call it `children` for single-slot components or `slot_N`
 * for additional unnamed slots.
 */
function normalizeSlots(slots: RawSlotDefinition[]): RawSlotDefinition[] {
  let fallbackIndex = 0;
  return slots.map((slot) => {
    if (slot.name.trim()) return slot;
    const name = fallbackIndex === 0 ? 'children' : `slot_${fallbackIndex}`;
    fallbackIndex++;
    return { ...slot, name };
  });
}
