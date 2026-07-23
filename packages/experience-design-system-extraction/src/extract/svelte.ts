import { basename, dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { parse as parseSvelte } from 'svelte/compiler';
import { Project, Node, ScriptTarget, ModuleKind, ts } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
  ExtractorOptions,
} from '../types.js';
import { computeExtractionScore, deriveNeedsReview } from './scoring.js';
import { extractAllowedComponentsFromTypeText } from './slot-allowed-components.js';

type RawSlotDefinitionInternal = RawSlotDefinition & {
  _rawTypeText?: string;
};

const SVELTE_EXTRACT_CONCURRENCY = Number(process.env['EDS_EXTRACT_CONCURRENCY'] ?? 0) || os.cpus().length;

interface AstNode {
  type: string;
  loc?: { start?: { line?: number }; end?: { line?: number } };
  [key: string]: unknown;
}
interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

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
  if (svelteFiles.length === 0) return { components: [], warnings: [] };

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];
  const retryContexts = new Map<string, RetryContext>();
  let filesProcessed = 0;
  let componentsFound = 0;

  const queue = [...svelteFiles];
  async function worker() {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) break;
      try {
        const source = await readFile(filePath, 'utf-8');
        const { component, warnings: fileWarnings, retryContext } = await extractFromSvelteFile(filePath, source);
        warnings.push(...fileWarnings);
        if (component) {
          components.push(component);
          componentsFound++;
        }
        if (retryContext) retryContexts.set(filePath, retryContext);
      } catch (e) {
        warnings.push(
          `${getSvelteComponentName(filePath)}: failed to extract from ${filePath} — ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      filesProcessed++;
      onProgress?.({ filesProcessed, componentsFound });
    }
  }

  await Promise.all(Array.from({ length: Math.min(SVELTE_EXTRACT_CONCURRENCY, svelteFiles.length) }, worker));

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

function collectReferencedTypeNames(node: AstNode): Set<string> {
  const names = new Set<string>();
  walk(node);
  return names;

  function walk(n: AstNode | undefined) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'TSTypeReference') {
      const tn = (n['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
      if (tn) names.add(tn);
    }
    if (n.type === 'TSExpressionWithTypeArguments') {
      const exprName = (n['expression'] as AstNode | undefined)?.['name'] as string | undefined;
      if (exprName) names.add(exprName);
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === 'object') walk(v as AstNode);
        }
      } else if (value && typeof value === 'object' && (value as AstNode).type) {
        walk(value as AstNode);
      }
    }
  }
}

function collectImportSpecifiersForNames(script: AstNode, names: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const body = (script['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return out;
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const specifierValue = (stmt['source'] as AstNode | undefined)?.['value'] as string | undefined;
    if (!specifierValue) continue;
    const specifiers = (stmt['specifiers'] as AstNode[] | undefined) ?? [];
    for (const spec of specifiers) {
      if (spec.type !== 'ImportSpecifier' && spec.type !== 'ImportDefaultSpecifier') continue;
      const localName = (spec['local'] as AstNode | undefined)?.['name'] as string | undefined;
      if (localName && names.has(localName)) out.set(localName, specifierValue);
    }
  }
  return out;
}

function locateDtsForSpecifier(req: NodeJS.Require, specifier: string, parentFile: string): string | null {
  let resolvedJs: string | null = null;
  try {
    resolvedJs = req.resolve(specifier);
  } catch {
    resolvedJs = null;
  }

  const seedDir = resolvedJs ? dirname(resolvedJs) : dirname(parentFile);
  const pkgRoot = findPackageRootForSpecifier(seedDir, specifier);
  if (pkgRoot) {
    const pkgJsonPath = join(pkgRoot, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgRaw = readFileSync(pkgJsonPath, 'utf-8') as string;
        const pkg = JSON.parse(pkgRaw) as { types?: string; typings?: string; exports?: unknown };
        const typesField = pkg.types ?? pkg.typings;
        if (typeof typesField === 'string') {
          const candidate = resolve(pkgRoot, typesField);
          if (existsSync(candidate)) return candidate;
        }
        const exportsTypes = extractTypesFromExports(pkg.exports);
        if (exportsTypes) {
          const candidate = resolve(pkgRoot, exportsTypes);
          if (existsSync(candidate)) return candidate;
        }
      } catch {}
    }
    for (const entry of ['index.d.ts', 'index.d.mts']) {
      const candidate = join(pkgRoot, entry);
      if (existsSync(candidate)) return candidate;
    }
  }

  if (resolvedJs) {
    const noExt = resolvedJs.replace(/\.(m?js|cjs)$/, '');
    for (const ext of ['.d.ts', '.d.mts']) {
      const candidate = `${noExt}${ext}`;
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function findPackageRootForSpecifier(seedDir: string, specifier: string): string | null {
  let dir = seedDir;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      try {
        const pkgRaw = readFileSync(join(dir, 'package.json'), 'utf-8') as string;
        const pkg = JSON.parse(pkgRaw) as { name?: string };
        if (pkg.name === specifier) return dir;
        if (pkg.name && specifier.startsWith(`${pkg.name}/`)) return dir;
      } catch {}
    }
    const parent = dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
  return null;
}

function extractTypesFromExports(exportsField: unknown): string | null {
  if (!exportsField || typeof exportsField !== 'object') return null;
  const exp = exportsField as Record<string, unknown>;
  const root = (exp['.'] ?? exp) as unknown;
  if (!root || typeof root !== 'object') return null;
  const r = root as Record<string, unknown>;
  if (typeof r['types'] === 'string') return r['types'];
  for (const key of ['import', 'default', 'node']) {
    const sub = r[key];
    if (sub && typeof sub === 'object') {
      const t = (sub as Record<string, unknown>)['types'];
      if (typeof t === 'string') return t;
    }
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

  let propsTypeNameCapture: string | undefined;
  if (propsCall) {
    const id = propsCall['id'] as AstNode | undefined;
    const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
    if (annotation?.type === 'TSTypeReference') {
      const tn = (annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
      if (tn && /^[A-Za-z_$][\w$]*$/.test(tn)) propsTypeNameCapture = tn;
    }
  }

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
  // A type-resolution failure is a strong signal something is wrong; force
  // human review even when other heuristics keep confidence above the threshold.
  component.needsReview = deriveNeedsReview(score.confidence) || extractionReasons.includes('props-type-unresolved');

  void propNamesTreatedAsSnippet;

  let retryContext: RetryContext | undefined;
  if (extractionReasons.includes('props-type-unresolved') && propsCall && instance) {
    const id = propsCall['id'] as AstNode | undefined;
    const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
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

const ANATOMY_FOLDERS = new Set(['anatomy', 'parts']);

function getSvelteComponentName(filePath: string): string {
  const file = basename(filePath, '.svelte');
  const parentDir = basename(dirname(filePath));
  if (file === 'index') return toPascalCase(parentDir);
  if (ANATOMY_FOLDERS.has(parentDir)) {
    const grandparent = basename(dirname(dirname(filePath)));
    if (grandparent && grandparent !== '.' && grandparent !== '/') {
      return `${toPascalCase(grandparent)}${toPascalCase(file)}`;
    }
  }
  return toPascalCase(file);
}

function toPascalCase(s: string): string {
  if (!s) return s;
  if (/^[A-Z]/.test(s) && !s.includes('-') && !s.includes('_')) return s;
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

function hasV4ExportLetProps(instance: AstNode): boolean {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return false;
  return body.some((stmt) => {
    if (stmt.type !== 'ExportNamedDeclaration') return false;
    const decl = stmt['declaration'] as AstNode | undefined;
    return decl?.type === 'VariableDeclaration' && decl['kind'] === 'let';
  });
}

function findPropsCall(instance: AstNode): AstNode | null {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return null;
  let found: AstNode | null = null;
  for (const stmt of body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    const decls = stmt['declarations'] as AstNode[] | undefined;
    if (!decls) continue;
    for (const d of decls) {
      const init = d['init'] as AstNode | undefined;
      if (!init || init.type !== 'CallExpression') continue;
      const callee = init['callee'] as AstNode | undefined;
      if (callee?.type === 'Identifier' && callee['name'] === '$props') {
        if (found === null) found = d;
      }
    }
  }
  return found;
}

function collectSnippetImportLocals(instance: AstNode): Set<string> {
  const locals = new Set<string>();
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return locals;
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const sourceNode = stmt['source'] as AstNode | undefined;
    if (sourceNode?.['value'] !== 'svelte') continue;
    const specs = stmt['specifiers'] as AstNode[] | undefined;
    if (!specs) continue;
    for (const spec of specs) {
      if (spec.type !== 'ImportSpecifier') continue;
      const imported = spec['imported'] as AstNode | undefined;
      const local = spec['local'] as AstNode | undefined;
      if (imported?.['name'] === 'Snippet' && typeof local?.['name'] === 'string') {
        locals.add(local['name'] as string);
      }
    }
  }
  return locals;
}

interface PropsCallContext {
  propsCall: AstNode;
  instance: AstNode;
  moduleScript?: AstNode;
  filePath: string;
  componentName: string;
  source: string;
  snippetLocals: Set<string>;
}

interface PropsExtractionResult {
  props: RawPropDefinition[];
  snippetNames: Set<string>;
  snippetSlots: RawSlotDefinition[];
  warnings: string[];
  additionalReasons?: string[];
}

async function extractPropsFromCall(ctx: PropsCallContext): Promise<PropsExtractionResult> {
  const warnings: string[] = [];
  const propsCall = ctx.propsCall;
  const id = propsCall['id'] as AstNode;
  const idType = id?.type;

  const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;

  const typeMembers = annotation
    ? await resolveTypeMembers(annotation, ctx.instance, ctx.moduleScript, ctx.filePath, ctx.source)
    : null;

  const unresolved = classifyUnresolved(annotation, typeMembers, ctx.instance, ctx.moduleScript);
  const additionalReasons: string[] = [];
  if (unresolved) {
    const refLabel = describeAnnotationForUser(annotation);
    const heritageNote = unresolved === 'partial-heritage' ? ' (heritage clauses extending unreachable types)' : '';
    warnings.push(
      `${ctx.componentName}: declared Props type ${refLabel} resolved to ${unresolved === 'empty' ? '0' : 'only Snippet-typed'} properties${heritageNote} (${ctx.filePath}) — possible cross-package extends or unreachable type. ` +
        `See https://github.com/contentful/experience-design-system-sdk-public/pull/44 for context and partner workarounds.`,
    );
    additionalReasons.push('props-type-unresolved');
  }

  if (idType === 'ObjectPattern') {
    return extractFromDestructure(ctx.propsCall, ctx, typeMembers, warnings, additionalReasons);
  }

  if (idType === 'Identifier') {
    if (typeMembers && typeMembers.length > 0) {
      return { ...extractFromTypeMembersOnly(typeMembers), warnings, additionalReasons };
    }
    if (!unresolved) {
      warnings.push(
        `${ctx.componentName}: $props() called without destructuring (${ctx.filePath}); cannot extract individual props`,
      );
    }
    return { props: [], snippetNames: new Set(), snippetSlots: [], warnings, additionalReasons };
  }

  warnings.push(`${ctx.componentName}: unrecognized $props() binding pattern '${idType}' (${ctx.filePath})`);
  return { props: [], snippetNames: new Set(), snippetSlots: [], warnings, additionalReasons };
}

function classifyUnresolved(
  annotation: AstNode | undefined,
  members: ResolvedTypeMember[] | null,
  instance: AstNode,
  moduleScript: AstNode | undefined,
): 'empty' | 'partial-heritage' | null {
  if (!annotation) return null;
  if (annotation.type === 'TSTypeLiteral') {
    const litMembers = (annotation['members'] as AstNode[] | undefined) ?? [];
    if (litMembers.length === 0) return null;
  }
  if (members === null || members.length === 0) return 'empty';

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const decl = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (decl && declarationHasHeritage(decl) && members.every((m) => m.isSnippet)) {
        return 'partial-heritage';
      }
    }
  }
  return null;
}

function describeAnnotationForUser(annotation: AstNode | undefined): string {
  if (!annotation) return '<unknown>';
  if (annotation.type === 'TSTypeReference') {
    const name = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    return name ? `'${name}'` : '<unnamed reference>';
  }
  if (annotation.type === 'TSIntersectionType') return '<intersection>';
  if (annotation.type === 'TSUnionType') return '<union>';
  if (annotation.type === 'TSTypeLiteral') return '<inline literal>';
  return `<${annotation.type}>`;
}

interface ResolvedTypeMember {
  name: string;
  optional: boolean;
  typeText: string;
  declaredTypeText?: string;
  isSnippet: boolean;
  allowedValues?: string[];
  description?: string;
  line?: number;
  endLine?: number;
}

async function resolveTypeMembers(
  annotation: AstNode,
  instance: AstNode,
  moduleScript: AstNode | undefined,
  filePath: string,
  source: string,
): Promise<ResolvedTypeMember[] | null> {
  const snippetLocals = mergeSets(
    collectSnippetImportLocals(instance),
    moduleScript ? collectSnippetImportLocals(moduleScript) : new Set<string>(),
  );

  if (annotation.type === 'TSTypeLiteral') {
    return readMembersFromTypeLiteral(annotation, snippetLocals);
  }

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const local = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (local) {
        const fastPathMembers = readMembersFromInterfaceOrAlias(local, snippetLocals);
        if (fastPathMembers.length > 0 && !declarationHasHeritage(local)) {
          return fastPathMembers;
        }
      } else {
        const imported =
          (await resolveImportedTypeMembers(refName, instance, filePath)) ??
          (moduleScript ? await resolveImportedTypeMembers(refName, moduleScript, filePath) : null);
        if (imported) return imported;
      }
    }
  }

  return resolveViaTypeChecker(annotation, instance, moduleScript, filePath, source, snippetLocals);
}

function declarationHasHeritage(decl: AstNode): boolean {
  if (decl.type === 'TSInterfaceDeclaration') {
    const ext = decl['extends'] as AstNode[] | undefined;
    return Array.isArray(ext) && ext.length > 0;
  }
  return false;
}

async function resolveViaTypeChecker(
  annotation: AstNode,
  instance: AstNode,
  moduleScript: AstNode | undefined,
  filePath: string,
  source: string,
  snippetLocals: Set<string>,
  externalProject?: Project,
): Promise<ResolvedTypeMember[] | null> {
  const annotationText = sliceSource(source, annotation);
  if (!annotationText) return null;

  const moduleText = sliceScriptContent(source, moduleScript);
  const instanceText = sliceScriptContent(source, instance);
  const synthetic = [moduleText, instanceText, `type __SveltePropsT__ = ${annotationText};`].filter(Boolean).join('\n');

  const project =
    externalProject ??
    new Project({
      compilerOptions: {
        strict: false,
        target: ScriptTarget.ESNext,
        module: ModuleKind.ESNext,
        allowJs: true,
        jsx: ts.JsxEmit.Preserve,
      },
      useInMemoryFileSystem: false,
      skipAddingFilesFromTsConfig: true,
    });
  const syntheticPath = `${filePath}.__svelte-props__.ts`;
  let sf: import('ts-morph').SourceFile;
  try {
    sf = project.createSourceFile(syntheticPath, synthetic, { overwrite: true });
  } catch {
    return null;
  }

  const alias = sf.getTypeAlias('__SveltePropsT__');
  if (!alias) return null;

  const type = alias.getType();
  const apparent = type.getApparentType();
  const properties = apparent.getProperties();
  if (properties.length === 0) return null;

  const members: ResolvedTypeMember[] = [];
  for (const symbol of properties) {
    const name = symbol.getName();
    const declaration = symbol.getValueDeclaration() ?? symbol.getDeclarations()[0];
    if (!declaration) continue;

    const propType = symbol.getTypeAtLocation(declaration);
    let typeText = propType.getText(declaration);
    const optional = symbol.isOptional();
    if (optional) {
      typeText = typeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
    }

    const allowed = extractAllowedValuesFromType(propType);
    const description = readJsDocFromDeclaration(declaration);
    const declaredTypeText = readDeclaredTypeNodeText(declaration);
    const isSnippet =
      (declaredTypeText !== null && isSnippetTypeText(declaredTypeText, snippetLocals)) ||
      typeRefersToSnippet(propType) ||
      isSnippetTypeText(typeText, snippetLocals);

    members.push({
      name,
      optional,
      typeText,
      ...(declaredTypeText ? { declaredTypeText } : {}),
      isSnippet,
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
    });
  }
  return members;
}

function sliceSource(source: string, node: AstNode): string | null {
  const start = (node['start'] as number | undefined) ?? null;
  const end = (node['end'] as number | undefined) ?? null;
  if (start == null || end == null) return null;
  return source.slice(start, end);
}

function sliceScriptContent(source: string, script: AstNode | undefined): string | null {
  if (!script) return null;
  const content = script['content'] as AstNode | undefined;
  if (!content) return null;
  return sliceSource(source, content);
}

function extractAllowedValuesFromType(type: import('ts-morph').Type): string[] | undefined {
  if (!type.isUnion()) return undefined;
  const out: string[] = [];
  for (const t of type.getUnionTypes()) {
    if (!t.isStringLiteral()) return undefined;
    out.push(t.getLiteralValueOrThrow() as string);
  }
  return out.length > 0 ? out : undefined;
}

function readJsDocFromDeclaration(decl: import('ts-morph').Node): string | undefined {
  if (Node.isPropertySignature(decl) || Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
    const jsdocs = decl.getJsDocs();
    if (jsdocs.length > 0) return jsdocs[0]!.getDescription().trim() || undefined;
  }
  return undefined;
}

function readDeclaredTypeNodeText(decl: import('ts-morph').Node): string | null {
  if (Node.isPropertySignature(decl)) {
    return decl.getTypeNode()?.getText() ?? null;
  }
  return null;
}

function isSnippetTypeText(typeText: string, snippetLocals: Set<string>): boolean {
  for (const local of snippetLocals) {
    if (typeText === local || typeText.startsWith(`${local}<`)) return true;
  }
  return typeText === 'Snippet' || typeText.startsWith('Snippet<');
}

type TsMorphType = import('ts-morph').Type;
function typeRefersToSnippet(propType: TsMorphType): boolean {
  const seen = new Set<TsMorphType>();
  let cursor: TsMorphType | undefined = propType;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const aliasName = cursor.getAliasSymbol()?.getName();
    const symName = cursor.getSymbol()?.getName();
    if (aliasName === 'Snippet' || symName === 'Snippet') {
      const decl = cursor.getAliasSymbol()?.getDeclarations()[0] ?? cursor.getSymbol()?.getDeclarations()[0];
      const file = decl?.getSourceFile().getFilePath() ?? '';
      if (file.includes('/svelte/') || file.includes('\\svelte\\') || file === '') return true;
    }
    if (cursor.isUnion()) {
      const nonUndef: TsMorphType[] = cursor.getUnionTypes().filter((t) => !t.isUndefined() && !t.isNull());
      if (nonUndef.length === 1) {
        cursor = nonUndef[0];
        continue;
      }
    }
    break;
  }
  return false;
}

function mergeSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const v of b) out.add(v);
  return out;
}

function findLocalTypeDeclaration(instance: AstNode, name: string, module?: AstNode): AstNode | null {
  for (const script of [instance, module]) {
    const body = (script?.['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
    if (!body) continue;
    for (const stmt of body) {
      const decl =
        stmt.type === 'ExportNamedDeclaration' ? ((stmt['declaration'] as AstNode | undefined) ?? stmt) : stmt;
      if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration') {
        const id = decl['id'] as AstNode | undefined;
        if (id?.['name'] === name) return decl;
      }
    }
  }
  return null;
}

function readMembersFromInterfaceOrAlias(decl: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  if (decl.type === 'TSInterfaceDeclaration') {
    const body = (decl['body'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
    if (!body) return [];
    return body.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
  }
  if (decl.type === 'TSTypeAliasDeclaration') {
    const ann = decl['typeAnnotation'] as AstNode | undefined;
    if (ann?.type === 'TSTypeLiteral') return readMembersFromTypeLiteral(ann, snippetLocals);
  }
  return [];
}

function readMembersFromTypeLiteral(literal: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  const members = literal['members'] as AstNode[] | undefined;
  if (!members) return [];
  return members.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
}

function readPropertySignature(member: AstNode, snippetLocals: Set<string>): ResolvedTypeMember | null {
  if (member.type !== 'TSPropertySignature') return null;
  const key = member['key'] as AstNode | undefined;
  const name = (key?.['name'] as string | undefined) ?? null;
  if (!name) return null;
  const optional = !!member['optional'];
  const typeNode = (member['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
  const typeText = renderType(typeNode);
  const isSnippet = isSnippetType(typeNode, snippetLocals);
  const allowedValues = collectStringLiteralUnion(typeNode);

  const leading = (member['leadingComments'] as Comment[] | undefined) ?? [];
  const description = extractJsdocText(leading);

  return {
    name,
    optional,
    typeText,
    isSnippet,
    allowedValues,
    description,
    line: member.loc?.start?.line,
    endLine: member.loc?.end?.line,
  };
}

function isSnippetType(typeNode: AstNode | undefined, snippetLocals: Set<string>): boolean {
  if (!typeNode) return false;
  if (typeNode.type !== 'TSTypeReference') return false;
  const tn = (typeNode['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
  if (!tn) return false;
  return snippetLocals.has(tn);
}

function collectStringLiteralUnion(typeNode: AstNode | undefined): string[] | undefined {
  if (!typeNode) return undefined;
  if (typeNode.type !== 'TSUnionType') return undefined;
  const members = typeNode['types'] as AstNode[] | undefined;
  if (!members) return undefined;
  const out: string[] = [];
  for (const m of members) {
    if (m.type !== 'TSLiteralType') return undefined;
    const lit = m['literal'] as AstNode | undefined;
    const v = lit?.['value'];
    if (typeof v !== 'string') return undefined;
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

function renderType(typeNode: AstNode | undefined): string {
  if (!typeNode) return 'unknown';
  switch (typeNode.type) {
    case 'TSStringKeyword':
      return 'string';
    case 'TSNumberKeyword':
      return 'number';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSAnyKeyword':
      return 'any';
    case 'TSUnknownKeyword':
      return 'unknown';
    case 'TSNullKeyword':
      return 'null';
    case 'TSUndefinedKeyword':
      return 'undefined';
    case 'TSVoidKeyword':
      return 'void';
    case 'TSArrayType': {
      return `${renderType(typeNode['elementType'] as AstNode)}[]`;
    }
    case 'TSTupleType': {
      const elements = (typeNode['elementTypes'] as AstNode[] | undefined) ?? [];
      const rendered = elements.map((el) => {
        if (el.type === 'TSNamedTupleMember') {
          const inner = el['elementType'] as AstNode | undefined;
          return renderType(inner);
        }
        return renderType(el);
      });
      return `[${rendered.join(', ')}]`;
    }
    case 'TSUnionType': {
      const members = (typeNode['types'] as AstNode[] | undefined) ?? [];
      return members.map(renderType).join(' | ');
    }
    case 'TSLiteralType': {
      const lit = typeNode['literal'] as AstNode | undefined;
      const v = lit?.['value'];
      if (typeof v === 'string') return `'${v}'`;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return 'unknown';
    }
    case 'TSTypeReference': {
      const tn = (typeNode['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
      const args = typeNode['typeArguments'] as AstNode | undefined;
      const base = tn ?? 'unknown';
      const params = (args?.['params'] as AstNode[] | undefined) ?? null;
      if (params && params.length > 0) {
        return `${base}<${params.map(renderType).join(', ')}>`;
      }
      return base;
    }
    case 'TSFunctionType': {
      const params = ((typeNode['params'] as AstNode[] | undefined) ?? []).map((p) => {
        const ann = (p['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
        const pname = (p['name'] as string | undefined) ?? 'arg';
        return `${pname}: ${renderType(ann)}`;
      });
      const ret = (typeNode['returnType'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
      return `(${params.join(', ')}) => ${renderType(ret)}`;
    }
    default:
      return 'unknown';
  }
}

function extractJsdocText(comments: Comment[]): string | undefined {
  if (!comments.length) return undefined;
  const last = comments[comments.length - 1]!;
  if (last.type !== 'Block') return undefined;
  const text = last.value
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}

function extractFromDestructure(
  propsCall: AstNode,
  _ctx: PropsCallContext,
  typeMembers: ResolvedTypeMember[] | null,
  warnings: string[],
  additionalReasons?: string[],
): PropsExtractionResult {
  const id = propsCall['id'] as AstNode;
  const properties = (id['properties'] as AstNode[] | undefined) ?? [];

  const typeByName = new Map<string, ResolvedTypeMember>();
  if (typeMembers) for (const m of typeMembers) typeByName.set(m.name, m);

  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];
  const seenInDestructure = new Set<string>();
  let dropsRest = false;

  for (const p of properties) {
    if (p.type === 'RestElement') {
      dropsRest = true;
      continue;
    }
    if (p.type !== 'Property') continue;

    const key = p['key'] as AstNode | undefined;
    const name = (key?.['name'] as string | undefined) ?? null;
    if (!name) continue;
    seenInDestructure.add(name);

    const value = p['value'] as AstNode | undefined;
    const hasDefault = value?.type === 'AssignmentPattern';
    const defaultValueRaw = hasDefault ? renderLiteral((value as AstNode)['right'] as AstNode | undefined) : undefined;

    const typeMember = typeByName.get(name);

    if (typeMember?.isSnippet) {
      snippetNames.add(name);
      const slot: RawSlotDefinitionInternal = {
        name,
        isDefault: name === 'children',
        ...(typeMember.description ? { description: typeMember.description } : {}),
      };
      const authorText = typeMember.declaredTypeText ?? typeMember.typeText;
      if (authorText) slot._rawTypeText = authorText;
      snippetSlots.push(slot);
      continue;
    }

    const required = typeMember ? !typeMember.optional && !hasDefault : !hasDefault;
    const propDef: RawPropDefinition = {
      name,
      type: typeMember?.typeText ?? 'unknown',
      required,
    };
    if (defaultValueRaw !== undefined) propDef.defaultValue = defaultValueRaw;
    if (typeMember?.allowedValues) propDef.allowedValues = typeMember.allowedValues;
    if (typeMember?.description) propDef.description = typeMember.description;
    props.push(propDef);
  }

  void dropsRest;

  return {
    props: props.sort((a, b) => sortStable(a.name, b.name, propertyOrder(properties))),
    snippetNames,
    snippetSlots,
    warnings,
    ...(additionalReasons && additionalReasons.length > 0 ? { additionalReasons } : {}),
  };
}

function extractFromTypeMembersOnly(typeMembers: ResolvedTypeMember[]): PropsExtractionResult {
  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];

  for (const m of typeMembers) {
    if (m.isSnippet) {
      snippetNames.add(m.name);
      const slot: RawSlotDefinitionInternal = {
        name: m.name,
        isDefault: m.name === 'children',
        ...(m.description ? { description: m.description } : {}),
      };
      const authorText = m.declaredTypeText ?? m.typeText;
      if (authorText) slot._rawTypeText = authorText;
      snippetSlots.push(slot);
      continue;
    }
    const propDef: RawPropDefinition = {
      name: m.name,
      type: m.typeText,
      required: !m.optional,
    };
    if (m.allowedValues) propDef.allowedValues = m.allowedValues;
    if (m.description) propDef.description = m.description;
    props.push(propDef);
  }

  return { props, snippetNames, snippetSlots, warnings: [] };
}

function propertyOrder(properties: AstNode[]): Map<string, number> {
  const m = new Map<string, number>();
  let i = 0;
  for (const p of properties) {
    if (p.type !== 'Property') continue;
    const name = ((p['key'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (name) m.set(name, i++);
  }
  return m;
}

function sortStable(a: string, b: string, order: Map<string, number>): number {
  const ai = order.get(a) ?? Infinity;
  const bi = order.get(b) ?? Infinity;
  if (ai !== bi) return ai - bi;
  return a.localeCompare(b);
}

function renderLiteral(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal') {
    const v = node['value'];
    const raw = node['raw'];
    if (typeof v === 'string') return `'${v}'`;
    if (typeof raw === 'string') return raw;
    if (v === null) return 'null';
    return String(v);
  }
  if (node.type === 'Identifier') return (node['name'] as string) ?? undefined;
  if (node.type === 'ArrayExpression') {
    const els = (node['elements'] as AstNode[] | undefined) ?? [];
    return `[${els.map((e) => renderLiteral(e) ?? '').join(', ')}]`;
  }
  if (node.type === 'ObjectExpression') return '{}';
  return undefined;
}

async function resolveImportedTypeMembers(
  typeName: string,
  instance: AstNode,
  filePath: string,
): Promise<ResolvedTypeMember[] | null> {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return null;

  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const specifierValue = (stmt['source'] as AstNode | undefined)?.['value'] as string | undefined;
    if (!specifierValue || !specifierValue.startsWith('.')) continue;

    const specifiers = (stmt['specifiers'] as AstNode[] | undefined) ?? [];
    let importedExport: string | null = null;
    for (const spec of specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      const localName = (spec['local'] as AstNode | undefined)?.['name'] as string | undefined;
      if (localName === typeName) {
        importedExport = ((spec['imported'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
        break;
      }
    }
    if (!importedExport) continue;

    const resolvedFile = resolveLocalScriptModule(filePath, specifierValue);
    if (!resolvedFile) continue;

    return readMembersFromExternalFile(resolvedFile, importedExport);
  }
  return null;
}

function resolveLocalScriptModule(importingFilePath: string, specifier: string): string | null {
  const basePath = resolve(dirname(importingFilePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.ts`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    join(basePath, 'index.js'),
    join(basePath, 'index.ts'),
    join(basePath, 'index.mjs'),
    join(basePath, 'index.cjs'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  if (basePath.endsWith('.js')) {
    const tsPath = `${basePath.slice(0, -'.js'.length)}.ts`;
    if (existsSync(tsPath) && statSync(tsPath).isFile()) return tsPath;
  }
  return null;
}

function readMembersFromExternalFile(filePath: string, exportName: string): ResolvedTypeMember[] | null {
  const project = new Project({
    compilerOptions: {
      strict: false,
      target: ScriptTarget.ESNext,
      module: ModuleKind.ESNext,
      allowJs: true,
    },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
  const sf = project.addSourceFileAtPathIfExists(filePath);
  if (!sf) return null;

  const snippetLocals = collectSnippetLocalsFromSourceFile(sf);
  const exportedDeclarations = sf.getExportedDeclarations();
  const decls = exportedDeclarations.get(exportName);
  if (!decls || decls.length === 0) return null;

  for (const decl of decls) {
    if (Node.isInterfaceDeclaration(decl)) {
      const declSf = decl.getSourceFile();
      const declLocals = declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf);
      return readInterfaceMembers(decl, declLocals);
    }
    if (Node.isTypeAliasDeclaration(decl)) {
      const typeNode = decl.getTypeNode();
      if (typeNode && Node.isTypeLiteral(typeNode)) {
        const declSf = decl.getSourceFile();
        const declLocals = declSf === sf ? snippetLocals : collectSnippetLocalsFromSourceFile(declSf);
        return readTypeLiteralMembers(typeNode, declLocals);
      }
    }
  }

  return null;
}

function collectSnippetLocalsFromSourceFile(sf: import('ts-morph').SourceFile): Set<string> {
  const locals = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    if (importDecl.getModuleSpecifierValue() !== 'svelte') continue;
    for (const named of importDecl.getNamedImports()) {
      if (named.getName() === 'Snippet') {
        const aliasNode = named.getAliasNode();
        locals.add(aliasNode ? aliasNode.getText() : named.getName());
      }
    }
  }
  return locals;
}

function readInterfaceMembers(
  iface: import('ts-morph').InterfaceDeclaration,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return iface.getProperties().map((prop) => {
    const typeNode = prop.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : prop.getType().getText(prop);
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = prop.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return {
      name: prop.getName(),
      optional: prop.hasQuestionToken(),
      typeText,
      isSnippet: isSnippetTypeText(typeText, snippetLocals),
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
      line: prop.getStartLineNumber(),
      endLine: prop.getEndLineNumber(),
    } satisfies ResolvedTypeMember;
  });
}

function readTypeLiteralMembers(
  typeNode: import('ts-morph').TypeLiteralNode,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return typeNode.getMembers().flatMap((m) => {
    if (!Node.isPropertySignature(m)) return [];
    const tn = m.getTypeNode();
    const typeText = tn ? tn.getText() : 'unknown';
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = m.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return [
      {
        name: m.getName(),
        optional: m.hasQuestionToken(),
        typeText,
        isSnippet: isSnippetTypeText(typeText, snippetLocals),
        ...(allowed ? { allowedValues: allowed } : {}),
        ...(description ? { description } : {}),
        line: m.getStartLineNumber(),
        endLine: m.getEndLineNumber(),
      } satisfies ResolvedTypeMember,
    ];
  });
}

function extractAllowedValuesFromText(typeText: string): string[] | undefined {
  const parts = typeText
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^'([^']*)'$/) ?? p.match(/^"([^"]*)"$/);
    if (!m) return undefined;
    out.push(m[1]!);
  }
  return out.length > 0 ? out : undefined;
}

function extractTemplateSlots(fragment: AstNode): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();
  walk(fragment);
  return slots;

  function walk(node: AstNode | undefined) {
    if (!node) return;
    if (node.type === 'SlotElement') {
      const name = readSlotName(node);
      if (!seen.has(name)) {
        seen.add(name);
        slots.push({ name, isDefault: name === 'default' });
      }
    }
    const children = (node['nodes'] as AstNode[] | undefined) ?? (node['children'] as AstNode[] | undefined) ?? [];
    for (const c of children) walk(c);
    const fragChild = node['fragment'] as AstNode | undefined;
    if (fragChild) walk(fragChild);
  }
}

function readSlotName(slotEl: AstNode): string {
  const attrs = (slotEl['attributes'] as AstNode[] | undefined) ?? [];
  for (const attr of attrs) {
    if (attr['name'] !== 'name') continue;
    const value = attr['value'] as AstNode[] | AstNode | undefined;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v.type === 'Text' && typeof v['data'] === 'string') return v['data'] as string;
      }
    }
  }
  return 'default';
}

function mergeSlots(
  fromSnippetProps: RawSlotDefinition[],
  fromTemplate: RawSlotDefinition[],
): { slots: RawSlotDefinition[]; mixedWarning: boolean } {
  if (fromSnippetProps.length === 0) return { slots: fromTemplate, mixedWarning: false };
  if (fromTemplate.length === 0) return { slots: fromSnippetProps, mixedWarning: false };

  const byName = new Map<string, RawSlotDefinition>();
  for (const s of fromSnippetProps) byName.set(s.name, s);
  const snippetHasDefault = fromSnippetProps.some((s) => s.isDefault);
  let mixed = false;
  for (const s of fromTemplate) {
    if (s.isDefault && snippetHasDefault) {
      mixed = true;
      continue;
    }
    if (byName.has(s.name)) {
      mixed = true;
      continue;
    }
    byName.set(s.name, s);
  }
  return { slots: [...byName.values()], mixedWarning: mixed };
}
