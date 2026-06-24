import { basename, dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import os from 'node:os';
import { parse as parseSvelte } from 'svelte/compiler';
import { Project, Node } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../../types.js';
import { computeExtractionScore, deriveNeedsReview } from './scoring.js';

const SVELTE_EXTRACT_CONCURRENCY = Number(process.env['EDS_EXTRACT_CONCURRENCY'] ?? 0) || os.cpus().length;

// Minimal estree-like types for the bits we read off the Svelte AST.
// We avoid pulling in @types/estree just for this — the AST nodes we care
// about have a stable shape across the Svelte 5 series.
interface AstNode {
  type: string;
  loc?: { start?: { line?: number }; end?: { line?: number } };
  [key: string]: unknown;
}
interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

export async function extractSvelteComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
): Promise<ComponentExtractionResult> {
  const svelteFiles = filePaths.filter((f) => f.endsWith('.svelte'));
  if (svelteFiles.length === 0) return { components: [], warnings: [] };

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];
  let filesProcessed = 0;
  let componentsFound = 0;

  const queue = [...svelteFiles];
  async function worker() {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) break;
      try {
        const source = await readFile(filePath, 'utf-8');
        const { component, warnings: fileWarnings } = await extractFromSvelteFile(filePath, source);
        warnings.push(...fileWarnings);
        if (component) {
          components.push(component);
          componentsFound++;
        }
      } catch (e) {
        warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
      }
      filesProcessed++;
      onProgress?.({ filesProcessed, componentsFound });
    }
  }

  await Promise.all(Array.from({ length: Math.min(SVELTE_EXTRACT_CONCURRENCY, svelteFiles.length) }, worker));

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

async function extractFromSvelteFile(
  filePath: string,
  source: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const warnings: string[] = [];

  let ast: AstNode;
  try {
    ast = parseSvelte(source, { modern: true }) as unknown as AstNode;
  } catch (e) {
    return {
      component: null,
      warnings: [`Parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const name = getSvelteComponentName(filePath);
  const instance = ast['instance'] as AstNode | undefined;
  const moduleScript = ast['module'] as AstNode | undefined;
  const fragment = ast['fragment'] as AstNode | undefined;

  // Detect Svelte 4 export-let syntax — currently unsupported.
  if (instance && hasV4ExportLetProps(instance)) {
    warnings.push(
      `Svelte 4 export let syntax not yet supported (file: ${filePath}); see INTEG-4267 for v5-only scope and follow-up`,
    );
    return { component: null, warnings };
  }

  // Find the $props() call (Svelte 5 runes).
  const propsCall = instance ? findPropsCall(instance) : null;

  // Snippet import map: localName -> true if it refers to `Snippet` from 'svelte'.
  const snippetLocals = instance ? collectSnippetImportLocals(instance) : new Set<string>();

  // --- Props extraction ---
  let props: RawPropDefinition[] = [];
  let propNamesTreatedAsSnippet = new Set<string>();
  let snippetSlotsFromProps: RawSlotDefinition[] = [];

  if (propsCall) {
    const result = await extractPropsFromCall({
      propsCall,
      instance: instance!,
      moduleScript,
      filePath,
      source,
      snippetLocals,
    });
    props = result.props;
    propNamesTreatedAsSnippet = result.snippetNames;
    snippetSlotsFromProps = result.snippetSlots;
    warnings.push(...result.warnings);
  } else if (instance) {
    // No $props() call. We've already ruled out v4 above; this means $props was used
    // but couldn't be located, or the script has no rune-style props at all.
    // Component still extracted (slots from template may exist).
  } else {
    // No script block at all — nothing to extract on the props side.
    warnings.push(`${filePath} has no instance script block; no props extracted`);
  }

  // --- Slot extraction ---
  const templateSlots = fragment ? extractTemplateSlots(fragment) : [];
  const { slots, mixedWarning } = mergeSlots(snippetSlotsFromProps, templateSlots);
  if (mixedWarning) {
    warnings.push(`${filePath}: mixed Snippet and <slot> usage detected; preferring Snippet entries`);
  }

  const component: RawComponentDefinition = {
    name,
    source: filePath,
    framework: 'svelte',
    props,
    slots,
  };

  // Score & flag review.
  const score = computeExtractionScore(component);
  component.extractionConfidence = score.confidence;
  component.reviewReasons = score.reasons;
  component.needsReview = deriveNeedsReview(score.confidence);

  // Validation issues (EMPTY_COMPONENT_NAME / EMPTY_PROP_NAME / PROP_SLOT_NAME_COLLISION /
  // DUPLICATE_COMPONENT_NAME / EMPTY_COMPONENT / EMPTY_SLOT_NAME) are populated
  // centrally by validateExtractedComponents() in analyze/command.ts after all
  // extractors return — same convention as React, Vue, Astro, Stencil, and
  // web-components. No per-extractor work needed here.

  void propNamesTreatedAsSnippet; // currently informational; reserved for future validation
  return { component, warnings };
}

// ---------------------------------------------------------------------------
// Component name
// ---------------------------------------------------------------------------

function getSvelteComponentName(filePath: string): string {
  const file = basename(filePath, '.svelte');
  // index.svelte → use parent directory name (mirrors index.vue behavior).
  if (file === 'index') {
    const parent = basename(dirname(filePath));
    return toPascalCase(parent);
  }
  return toPascalCase(file);
}

function toPascalCase(s: string): string {
  if (!s) return s;
  // Already PascalCase? leave it.
  if (/^[A-Z]/.test(s) && !s.includes('-') && !s.includes('_')) return s;
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

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
        // Multiple $props() calls — first wins; we'll warn from the caller.
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

// ---------------------------------------------------------------------------
// Props extraction
// ---------------------------------------------------------------------------

interface PropsCallContext {
  propsCall: AstNode;
  instance: AstNode;
  moduleScript?: AstNode;
  filePath: string;
  source: string;
  snippetLocals: Set<string>;
}

interface PropsExtractionResult {
  props: RawPropDefinition[];
  snippetNames: Set<string>;
  snippetSlots: RawSlotDefinition[];
  warnings: string[];
}

async function extractPropsFromCall(ctx: PropsCallContext): Promise<PropsExtractionResult> {
  const warnings: string[] = [];
  const propsCall = ctx.propsCall;
  const id = propsCall['id'] as AstNode;
  const idType = id?.type;

  // Decode the type annotation (the right side of `: Props` / `: { ... }`).
  const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;

  // Resolve the type members once (works for both ObjectPattern and Identifier id forms).
  const typeMembers = annotation
    ? await resolveTypeMembers(annotation, ctx.instance, ctx.moduleScript, ctx.filePath, ctx.source)
    : null;

  if (idType === 'ObjectPattern') {
    return extractFromDestructure(ctx.propsCall, ctx, typeMembers, warnings);
  }

  if (idType === 'Identifier') {
    // const props: Props = $props(); — no destructure, no defaults, no per-name binding.
    if (typeMembers) {
      return extractFromTypeMembersOnly(typeMembers, ctx.snippetLocals, warnings);
    }
    warnings.push(`${ctx.filePath}: $props() called without destructuring; cannot extract individual props`);
    return { props: [], snippetNames: new Set(), snippetSlots: [], warnings };
  }

  warnings.push(`${ctx.filePath}: unrecognized $props() binding pattern (${idType})`);
  return { props: [], snippetNames: new Set(), snippetSlots: [], warnings };
}

interface ResolvedTypeMember {
  name: string;
  optional: boolean;
  typeText: string;
  /** True if this member's type resolves to the `Snippet` type from 'svelte'. */
  isSnippet: boolean;
  allowedValues?: string[];
  description?: string;
  /** 1-indexed line in the original .svelte file. */
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
  // Snippet imports may live in either script block; collect from both.
  const snippetLocals = mergeSets(
    collectSnippetImportLocals(instance),
    moduleScript ? collectSnippetImportLocals(moduleScript) : new Set<string>(),
  );

  // Fast path 1: inline type literal with no extends/intersection. The AST already
  // gives us member-level optional/type/JSDoc; no ts-morph needed.
  if (annotation.type === 'TSTypeLiteral') {
    return readMembersFromTypeLiteral(annotation, snippetLocals);
  }

  // For named refs: try the AST fast path first (inline interface or type literal alias
  // with no heritage clauses). If that returns >0 members AND the source declaration has
  // no extends, we trust it. Otherwise fall back to ts-morph type-checker resolution to
  // pick up extends / Omit / intersection / Partial / generics.
  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const local = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (local) {
        const fastPathMembers = readMembersFromInterfaceOrAlias(local, snippetLocals);
        if (fastPathMembers.length > 0 && !declarationHasHeritage(local)) {
          return fastPathMembers;
        }
        // Heritage or empty body — fall through to ts-morph resolution.
      } else {
        // No local declaration — try import resolution via ts-morph.
        const imported =
          (await resolveImportedTypeMembers(refName, instance, filePath)) ??
          (moduleScript ? await resolveImportedTypeMembers(refName, moduleScript, filePath) : null);
        if (imported) return imported;
      }
    }
  }

  // Slow path: ts-morph type-checker resolution. Materializes the annotation text as
  // `type __SveltePropsT__ = <annotation>;` inside an in-memory file containing the
  // combined script bodies, then reads .getType().getProperties(). The TS checker
  // resolves extends, &, Omit, Pick, Partial, generics — anything TS itself resolves.
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
): Promise<ResolvedTypeMember[] | null> {
  const annotationText = sliceSource(source, annotation);
  if (!annotationText) return null;

  // Reconstruct the combined script content: module-script first, then instance.
  // Both bodies share scope in the synthetic file, which is enough for TS to resolve
  // local interfaces, type aliases, imports, and heritage clauses across them.
  const moduleText = sliceScriptContent(source, moduleScript);
  const instanceText = sliceScriptContent(source, instance);
  const synthetic = [moduleText, instanceText, `type __SveltePropsT__ = ${annotationText};`].filter(Boolean).join('\n');

  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true, jsx: 1 },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
  // Place the synthetic file alongside the .svelte so relative imports resolve.
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
    // Strip ` | undefined` for clean output on optional props.
    const optional = symbol.isOptional();
    if (optional) {
      typeText = typeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
    }

    const allowed = extractAllowedValuesFromType(propType);
    const description = readJsDocFromDeclaration(declaration);
    const isSnippet = isSnippetTypeText(typeText, snippetLocals);

    members.push({
      name,
      optional,
      typeText,
      isSnippet,
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
      // line/endLine: prefer AST-derived location when the source declaration is in our
      // svelte file. ts-morph's synthetic location refers to the synthetic file and
      // isn't useful for the user.
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

function isSnippetTypeText(typeText: string, snippetLocals: Set<string>): boolean {
  // Direct match against the local Snippet name (handles aliasing).
  for (const local of snippetLocals) {
    if (typeText === local || typeText.startsWith(`${local}<`)) return true;
  }
  // Defensive fallback: TS may surface the canonical `Snippet` from the import.
  return typeText === 'Snippet' || typeText.startsWith('Snippet<');
}

function mergeSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const v of b) out.add(v);
  return out;
}

function findLocalTypeDeclaration(instance: AstNode, name: string, module?: AstNode): AstNode | null {
  // Skeleton-svelte and similar libraries declare the Props interface in
  // <script lang="ts" module> and consume it in the regular <script>. Look
  // in both bodies. Type declarations may also be wrapped in
  // `export { ... }` statements (ExportNamedDeclaration with .declaration).
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

  // JSDoc / comments — `leadingComments` may be on the member or on the parent.
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
    if (m.type !== 'TSLiteralType') return undefined; // not a pure literal union
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
  // Strip leading * on each line, trim, join.
  const text = last.value
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}

// ---------------------------------------------------------------------------
// Extraction: ObjectPattern destructure + type-members
// ---------------------------------------------------------------------------

function extractFromDestructure(
  propsCall: AstNode,
  ctx: PropsCallContext,
  typeMembers: ResolvedTypeMember[] | null,
  warnings: string[],
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
      snippetSlots.push({
        name,
        isDefault: name === 'children',
        ...(typeMember.description ? { description: typeMember.description } : {}),
      });
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

  // Note: members declared in the type but not destructured are intentionally NOT surfaced
  // here. With `let { foo, ...rest } = $props()`, only `foo` is bound by name; the rest
  // are collected into the rest binding and are not individually addressable. Authoring
  // contract = the destructure list. (Type-members-only path runs separately for the
  // `const props: Props = $props()` no-destructure case.)

  if (dropsRest) {
    warnings.push(`${ctx.filePath}: rest element in $props() destructure dropped (cannot enumerate)`);
  }

  return {
    props: props.sort((a, b) => sortStable(a.name, b.name, propertyOrder(properties))),
    snippetNames,
    snippetSlots,
    warnings,
  };
}

function extractFromTypeMembersOnly(
  typeMembers: ResolvedTypeMember[],
  _snippetLocals: Set<string>,
  _warnings: string[],
): PropsExtractionResult {
  const props: RawPropDefinition[] = [];
  const snippetNames = new Set<string>();
  const snippetSlots: RawSlotDefinition[] = [];

  for (const m of typeMembers) {
    if (m.isSnippet) {
      snippetNames.add(m.name);
      snippetSlots.push({
        name: m.name,
        isDefault: m.name === 'children',
        ...(m.description ? { description: m.description } : {}),
      });
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

// ---------------------------------------------------------------------------
// Imported Props resolution via ts-morph (cross-file)
// ---------------------------------------------------------------------------

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
  // Fallback: handle `.js` import that maps to a `.ts` source on disk (NodeNext convention)
  if (basePath.endsWith('.js')) {
    const tsPath = `${basePath.slice(0, -'.js'.length)}.ts`;
    if (existsSync(tsPath) && statSync(tsPath).isFile()) return tsPath;
  }
  return null;
}

function readMembersFromExternalFile(filePath: string, exportName: string): ResolvedTypeMember[] | null {
  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });
  const sf = project.addSourceFileAtPathIfExists(filePath);
  if (!sf) return null;

  // Collect Snippet locals from the resolved file's own imports so that
  // aliased imports (`import { Snippet as LocalSnippet } from 'svelte'`) are
  // honored. Mirrors collectSnippetImportLocals() but adapted to ts-morph.
  const snippetLocals = collectSnippetLocalsFromSourceFile(sf);

  // Use getExportedDeclarations() so re-export chains (`export { ... } from './x'`,
  // `export * from './x'`, named or namespace) resolve transparently. ts-morph
  // follows them recursively and returns the underlying declaration.
  const exportedDeclarations = sf.getExportedDeclarations();
  const decls = exportedDeclarations.get(exportName);
  if (!decls || decls.length === 0) return null;

  for (const decl of decls) {
    if (Node.isInterfaceDeclaration(decl)) {
      // The declaration may live in a different source file than `sf` if the
      // export chain walked across files; pull snippet locals from that file
      // so aliased imports are recognized.
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
  // Quick parse of `'a' | 'b' | 'c'`.
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

// ---------------------------------------------------------------------------
// Slot extraction (template <slot> + Snippet props merge)
// ---------------------------------------------------------------------------

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
    // Default <slot/> in template is the same surface as a `children: Snippet` prop.
    // Prefer the Snippet entry when both are present.
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
