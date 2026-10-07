import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Project, ScriptTarget, ModuleKind, ts } from 'ts-morph';
import type { RawComponentDefinition } from '../../../types/component.js';
import type { ExtractorOptions } from '../../../types/options.js';
import {
  computeExtractionScore,
  deriveNeedsReview,
} from '../../../services/quality/helpers/scoring/compute-extraction-score.js';
import { mergeSlots } from './extract-svelte-template-slots.js';
import type { AstNode } from '../types/svelte-ast-node.js';
import {
  collectSnippetImportLocals,
  mergeSets,
  findLocalTypeDeclaration,
  collectReferencedTypeNames,
  collectImportSpecifiersForNames,
} from './find-svelte-script-declarations.js';
import { resolveViaTypeChecker, type ResolvedTypeMember } from './resolve-svelte-type-members.js';
import { extractFromTypeMembersOnly } from './extract-svelte-props.js';
import { locateDtsForSpecifier } from './resolve-dts-location.js';

export interface RetryContext {
  filePath: string;
  source: string;
  instance: AstNode;
  moduleScript: AstNode | undefined;
  annotation: AstNode;
  componentName: string;
}

async function retryComponentWithProject(
  component: RawComponentDefinition,
  ctx: RetryContext,
  project: Project,
  warnings: string[],
): Promise<boolean> {
  const snippetLocals = mergeSets(
    collectSnippetImportLocals(ctx.instance),
    ctx.moduleScript ? collectSnippetImportLocals(ctx.moduleScript) : new Set<string>(),
  );

  let members: ResolvedTypeMember[] | null = null;
  try {
    members = await resolveViaTypeChecker(
      ctx.annotation,
      ctx.instance,
      ctx.moduleScript,
      ctx.filePath,
      ctx.source,
      snippetLocals,
      project,
    );
  } catch {
    members = null;
  }

  if (!members || members.length === 0) return false;

  const { props, snippetSlots } = extractFromTypeMembersOnly(members);
  const templateSlots = component.slots.filter((s) => !snippetSlots.some((ss) => ss.name === s.name));
  const finalSlots = mergeSlots(snippetSlots, templateSlots).slots;
  const slotNames = new Set(finalSlots.map((s) => s.name));
  component.props = props.filter((p) => !slotNames.has(p.name));
  component.slots = finalSlots;

  const remainingReasons = (component.reviewReasons ?? []).filter((r) => r !== 'props-type-unresolved');
  const score = computeExtractionScore(component, {
    additionalIssueCount: remainingReasons.length,
    additionalReasons: remainingReasons,
  });
  component.extractionConfidence = score.confidence;
  component.reviewReasons = score.reasons;
  component.needsReview = deriveNeedsReview(score.confidence);

  const componentName = component.name;
  const idx = warnings.findIndex(
    (w) => w.startsWith(`${componentName}: declared Props type `) && /resolved to /.test(w),
  );
  if (idx >= 0) warnings.splice(idx, 1);

  return true;
}

function addImportedDeclarationsToProject(project: Project, ctx: RetryContext): number {
  const importedNames = collectReferencedTypeNames(ctx.annotation);
  for (const name of [...importedNames]) {
    const localDecl =
      findLocalTypeDeclaration(ctx.instance, name, ctx.moduleScript) ??
      (ctx.moduleScript ? findLocalTypeDeclaration(ctx.moduleScript, name, ctx.instance) : null);
    if (localDecl) {
      for (const referenced of collectReferencedTypeNames(localDecl)) importedNames.add(referenced);
    }
  }
  if (importedNames.size === 0) return 0;

  const imports = collectImportSpecifiersForNames(ctx.instance, importedNames);
  if (ctx.moduleScript) {
    for (const [k, v] of collectImportSpecifiersForNames(ctx.moduleScript, importedNames)) imports.set(k, v);
  }
  if (imports.size === 0) return 0;

  const req = createRequire(ctx.filePath);
  let added = 0;
  for (const specifier of imports.values()) {
    if (specifier.startsWith('.')) continue;
    const dtsPath = locateDtsForSpecifier(req, specifier, ctx.filePath);
    if (!dtsPath) continue;
    try {
      const sf = project.addSourceFileAtPathIfExists(dtsPath);
      if (sf) added++;
    } catch {}
  }
  return added;
}

export async function maybeRunResolveUnreachableRetry(
  components: RawComponentDefinition[],
  warnings: string[],
  retryContexts: Map<string, RetryContext>,
  opts: ExtractorOptions | undefined,
): Promise<string[]> {
  const mode = opts?.resolveUnreachable ?? 'auto';
  if (mode === 'never') return warnings;

  const isUnresolved = (c: RawComponentDefinition) =>
    (c.reviewReasons ?? []).includes('props-type-unresolved') && !!retryContexts.get(c.source);
  const unresolvedCount = components.filter(isUnresolved).length;
  if (unresolvedCount === 0) return warnings;

  if (mode === 'auto') {
    const ratio = unresolvedCount / components.length;
    if (ratio < 0.2) return warnings;
  }

  const projectRoot = opts?.projectRoot;
  let project: Project | null = null;
  let tsconfigPath: string | null = null;
  if (projectRoot) {
    tsconfigPath = findNearestTsconfig(projectRoot);
  }
  if (tsconfigPath) {
    try {
      project = new Project({
        tsConfigFilePath: tsconfigPath,
        skipAddingFilesFromTsConfig: false,
        compilerOptions: {
          allowJs: true,
          jsx: ts.JsxEmit.Preserve,
        },
      });
    } catch {
      project = null;
    }
  }

  let recoveredViaTsconfig = 0;
  if (project) {
    for (const component of components) {
      if (!isUnresolved(component)) continue;
      const ctx = retryContexts.get(component.source);
      if (!ctx) continue;
      const recovered = await retryComponentWithProject(component, ctx, project, warnings);
      if (recovered) recoveredViaTsconfig++;
    }
  }

  let recoveredViaNodeModules = 0;
  const stillUnresolved = components.filter(isUnresolved);
  if (stillUnresolved.length > 0) {
    if (!project) {
      project = new Project({
        compilerOptions: {
          strict: false,
          target: ScriptTarget.ESNext,
          module: ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
          allowJs: true,
          jsx: ts.JsxEmit.Preserve,
        },
        useInMemoryFileSystem: false,
        skipAddingFilesFromTsConfig: true,
      });
    }
    for (const component of stillUnresolved) {
      const ctx = retryContexts.get(component.source);
      if (!ctx) continue;

      const added = addImportedDeclarationsToProject(project, ctx);
      if (added === 0) continue;

      const recovered = await retryComponentWithProject(component, ctx, project, warnings);
      if (recovered) recoveredViaNodeModules++;
    }
  }

  const didMeaningfulWork = !!tsconfigPath || recoveredViaNodeModules > 0;
  if (didMeaningfulWork) {
    const remaining = components.filter(isUnresolved).length;
    const parts: string[] = [];
    if (tsconfigPath) {
      parts.push(`tsconfig at ${tsconfigPath} recovered ${recoveredViaTsconfig} component(s)`);
    }
    parts.push(`node_modules pass recovered ${recoveredViaNodeModules} more`);
    parts.push(`${remaining} component(s) remain unresolved`);
    warnings.push(`Unresolved-type retry pass (mode=${mode}): ${parts.join('; ')}.`);
  }

  return warnings;
}

function findNearestTsconfig(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 16; i++) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function collapseUnresolvedTypeWarnings(warnings: string[]): string[] {
  const isUnresolvedWarning = (w: string) => /declared Props type .* resolved to/.test(w);
  const unresolvedCount = warnings.filter(isUnresolvedWarning).length;
  if (unresolvedCount < 3) return warnings;

  const others = warnings.filter((w) => !isUnresolvedWarning(w));
  const summary =
    `Unresolved component types: ${unresolvedCount} components have a declared Props type the parser couldn't fully resolve — ` +
    `most often a cross-package extends pattern (e.g. an interface that extends a type from a node_modules package). ` +
    `Each affected component is flagged with reviewReasons: ['props-type-unresolved'] and needsReview = true; ` +
    `select one in the TUI to drill in. ` +
    `See https://github.com/contentful/experience-design-system-sdk-public/pull/44 for context and partner workarounds.`;
  return [summary, ...others];
}
