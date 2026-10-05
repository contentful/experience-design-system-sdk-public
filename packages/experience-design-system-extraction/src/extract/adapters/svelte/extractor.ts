import os from 'node:os';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse as parseSvelte } from 'svelte/compiler';
import { Project, ScriptTarget, ModuleKind, ts } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../../model/component.js';
import type { ExtractorOptions } from '../../model/options.js';
import { computeExtractionScore, deriveNeedsReview } from '../../policies/quality/scoring.js';
import { extractAllowedComponentsFromTypeText } from '../../evidence/allowed-components.js';
import { runFileExtractionWorkers } from '../support/file-processing/file-workers.js';
import type { AstNode } from './ast.js';
import { getSvelteComponentName } from './identity.js';
import { extractTemplateSlots, mergeSlots } from './slots.js';
import { hasV4ExportLetProps, findPropsCall, collectSnippetImportLocals, findLocalTypeDeclaration, mergeSets, collectReferencedTypeNames, collectImportSpecifiersForNames } from './helpers/traverse-svelte-ast.js';
import { resolveViaTypeChecker, type ResolvedTypeMember } from './helpers/resolve-svelte-type-members.js';
import { extractFromTypeMembersOnly, extractPropsFromCall, capturePropsTypeName, buildRetryAnnotation } from './helpers/extract-svelte-props.js';
import { locateDtsForSpecifier } from './helpers/resolve-dts-location.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};

interface RetryContext {
  filePath: string;
  source: string;
  instance: AstNode;
  moduleScript: AstNode | undefined;
  annotation: AstNode;
  componentName: string;
}

export async function extractSvelteComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const svelteFiles = filePaths.filter((f) => f.endsWith('.svelte'));
  const retryContexts = new Map<string, RetryContext>();
  const { items: components, warnings } = await runFileExtractionWorkers(
    svelteFiles,
    os.cpus().length,
    async (filePath, source) => {
      const { component, warnings: fileWarnings, retryContext } = await extractFromSvelteFile(filePath, source);
      return { item: component, warnings: fileWarnings, metadata: retryContext };
    },
    (filePath, error) =>
      `${getSvelteComponentName(filePath)}: failed to extract from ${filePath} — ${error instanceof Error ? error.message : String(error)}`,
    onProgress,
    (filePath, outcome) => {
      if (outcome.metadata) retryContexts.set(filePath, outcome.metadata);
    },
  );

  const finalWarnings = await maybeRunResolveUnreachableRetry(components, warnings, retryContexts, opts);

  resolveAllowedComponents(components);

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings: collapseUnresolvedTypeWarnings(finalWarnings),
  };
}

function resolveAllowedComponents(components: RawComponentDefinition[]): void {
  const propsToComponent = new Map<string, string>();
  const componentNames = new Set<string>();
  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    componentNames.add(c.name);
    if (c._propsTypeName) propsToComponent.set(c._propsTypeName, c.name);
  }

  for (const c of components as Array<RawComponentDefinition & { _propsTypeName?: string }>) {
    for (const slot of c.slots as RawSlotDefinitionInternal[]) {
      const raw = slot._rawTypeText;
      if (raw) {
        const found = extractAllowedComponentsFromTypeText(raw, { propsToComponent, componentNames });
        if (found.length > 0) slot.allowedComponents = found;
      }
      delete slot._rawTypeText;
    }
    delete c._propsTypeName;
  }
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

async function maybeRunResolveUnreachableRetry(
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

function collapseUnresolvedTypeWarnings(warnings: string[]): string[] {
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

async function extractFromSvelteFile(
  filePath: string,
  source: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[]; retryContext?: RetryContext }> {
  const warnings: string[] = [];
  const name = getSvelteComponentName(filePath);

  let ast: AstNode;
  try {
    ast = parseSvelte(source, { modern: true }) as unknown as AstNode;
  } catch (e) {
    return {
      component: null,
      warnings: [`${name}: parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const instance = ast['instance'] as AstNode | undefined;
  const moduleScript = ast['module'] as AstNode | undefined;
  const fragment = ast['fragment'] as AstNode | undefined;

  if (instance && hasV4ExportLetProps(instance)) {
    warnings.push(
      `${name}: Svelte 4 export let syntax not yet supported (${filePath}); see INTEG-4267 for v5-only scope and follow-up`,
    );
    return { component: null, warnings };
  }

  const propsCall = instance ? findPropsCall(instance) : null;
  const snippetLocals = instance ? collectSnippetImportLocals(instance) : new Set<string>();

  let props: RawPropDefinition[] = [];
  let propNamesTreatedAsSnippet = new Set<string>();
  let snippetSlotsFromProps: RawSlotDefinition[] = [];
  const extractionReasons: string[] = [];

  if (propsCall) {
    const result = await extractPropsFromCall({
      propsCall,
      instance: instance!,
      moduleScript,
      filePath,
      componentName: name,
      source,
      snippetLocals,
    });
    props = result.props;
    propNamesTreatedAsSnippet = result.snippetNames;
    snippetSlotsFromProps = result.snippetSlots;
    warnings.push(...result.warnings);
    if (result.additionalReasons) extractionReasons.push(...result.additionalReasons);
  } else if (instance) {
  } else {
    warnings.push(`${name}: no instance script block (${filePath}); no props extracted`);
  }

  const templateSlots = fragment ? extractTemplateSlots(fragment) : [];
  const { slots, mixedWarning } = mergeSlots(snippetSlotsFromProps, templateSlots);
  if (mixedWarning) {
    warnings.push(`${name}: mixed Snippet and <slot> usage detected (${filePath}); preferring Snippet entries`);
  }

  const propsTypeNameCapture = propsCall ? capturePropsTypeName(propsCall) : undefined;

  const component: RawComponentDefinition & { _propsTypeName?: string } = {
    name,
    source: filePath,
    framework: 'svelte',
    props,
    slots,
    ...(propsTypeNameCapture ? { _propsTypeName: propsTypeNameCapture } : {}),
  };

  const score = computeExtractionScore(component, {
    additionalIssueCount: extractionReasons.length,
    additionalReasons: extractionReasons,
  });
  component.extractionConfidence = score.confidence;
  component.reviewReasons = score.reasons;
  component.needsReview = deriveNeedsReview(score.confidence) || extractionReasons.includes('props-type-unresolved');

  void propNamesTreatedAsSnippet;

  let retryContext: RetryContext | undefined;
  if (extractionReasons.includes('props-type-unresolved') && propsCall && instance) {
    const annotation = buildRetryAnnotation(propsCall);
    if (annotation) {
      retryContext = {
        filePath,
        source,
        instance,
        moduleScript,
        annotation,
        componentName: name,
      };
    }
  }

  return { component, warnings, ...(retryContext ? { retryContext } : {}) };
}

