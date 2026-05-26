import { basename, dirname, resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { Project, Node } from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../../types.js';

// @vue/compiler-core NodeTypes enum values (stable since Vue 3.0)
const ELEMENT_TYPE = 1;
const ATTRIBUTE_TYPE = 6;

const VUE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'any[]',
  Object: 'object',
  Function: 'function',
  Date: 'Date',
  Symbol: 'symbol',
};

// Minimal structural types for walking the template AST
interface TemplateAttrNode {
  type: number;
  name?: string;
  value?: { content?: string };
}

interface TemplateAstNode {
  type: number;
  tag?: string;
  props?: TemplateAttrNode[];
  children?: (TemplateAstNode | unknown)[];
}

const VUE_EXTRACT_CONCURRENCY = Number(process.env['EDS_EXTRACT_CONCURRENCY'] ?? 0) || os.cpus().length;

export async function extractVueComponents(
  filePaths: string[],
  onProgress?: (p: { filesProcessed: number; componentsFound: number }) => void,
): Promise<ComponentExtractionResult> {
  const vueFiles = filePaths.filter((f) => f.endsWith('.vue'));
  if (vueFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];
  let filesProcessed = 0;
  let componentsFound = 0;

  const queue = [...vueFiles];
  async function worker() {
    while (queue.length > 0) {
      const filePath = queue.shift();
      if (!filePath) break;
      try {
        const source = await readFile(filePath, 'utf-8');
        const { component, warnings: fileWarnings } = await extractFromVueSFC(filePath, source);
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

  await Promise.all(Array.from({ length: Math.min(VUE_EXTRACT_CONCURRENCY, vueFiles.length) }, worker));

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

async function extractFromVueSFC(
  filePath: string,
  source: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const { descriptor, errors } = parseSFC(source);
  const fileWarnings: string[] = errors.map(
    (e) => `Parse error in ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
  );
  const name = getVueComponentName(filePath);

  // Props: <script setup> wins over Options API <script>
  let props: RawPropDefinition[] = [];
  const setupProps = descriptor.scriptSetup ? await extractSetupProps(filePath, descriptor.scriptSetup.content) : null;
  if (setupProps !== null) {
    props = setupProps;
  } else if (descriptor.script) {
    return extractOptionsComponent(
      filePath,
      descriptor.script.content,
      fileWarnings,
      name,
      descriptor.template?.ast,
      source,
    );
  }

  // Slots: from template AST + runtime $slots access
  let slots = descriptor.template?.ast
    ? extractSlotsFromTemplate(descriptor.template.ast as unknown as TemplateAstNode)
    : [];
  const runtimeSlots = extractSlotsFromRuntimeAccess(source);
  slots = mergeSlotsDedup(slots, runtimeSlots);

  return {
    component: {
      name,
      source: filePath,
      framework: 'vue',
      props,
      slots,
    },
    warnings: fileWarnings,
  };
}

function getVueComponentName(filePath: string): string {
  const fileName = basename(filePath, '.vue');
  if (fileName !== 'index') {
    return fileName;
  }

  const parentDirName = basename(dirname(filePath));
  return parentDirName || fileName;
}

async function extractOptionsComponent(
  filePath: string,
  scriptContent: string,
  fileWarnings: string[],
  name: string,
  templateAst?: unknown,
  sfcSource?: string,
): Promise<{ component: RawComponentDefinition | null; warnings: string[] }> {
  const props = await extractOptionsProps(filePath, scriptContent);
  let slots = templateAst ? extractSlotsFromTemplate(templateAst as TemplateAstNode) : [];
  if (sfcSource) {
    const runtimeSlots = extractSlotsFromRuntimeAccess(sfcSource);
    slots = mergeSlotsDedup(slots, runtimeSlots);
  }

  return {
    component: {
      name,
      source: filePath,
      framework: 'vue',
      props,
      slots,
    },
    warnings: fileWarnings,
  };
}

type SetupImportedObjectRef = {
  filePath: string;
  exportName: string;
};

async function extractSetupProps(filePath: string, scriptSetupContent: string): Promise<RawPropDefinition[] | null> {
  const project = new Project({
    compilerOptions: {
      strict: false,
      target: 99, // ESNext
      module: 99, // ESNext
      allowJs: true,
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__setup__.ts', scriptSetupContent);

  // Try generic syntax: defineProps<{...}>()
  let genericTypeText: string | null = null;
  sf.forEachDescendant((node) => {
    if (genericTypeText !== null) return;
    if (
      Node.isCallExpression(node) &&
      node.getExpression().getText() === 'defineProps' &&
      node.getTypeArguments().length > 0
    ) {
      genericTypeText = node.getTypeArguments()[0].getText();
    }
  });

  if (genericTypeText !== null) {
    return extractGenericProps(genericTypeText);
  }

  const importedObjectRefs = collectSetupImportedObjectRefs(sf, filePath);

  // Try object syntax: defineProps({...})
  let objectProps: RawPropDefinition[] | null = null;
  const visitedImports = new Set<string>();
  for (const node of sf.getDescendants()) {
    if (objectProps !== null) break;
    if (
      Node.isCallExpression(node) &&
      node.getExpression().getText() === 'defineProps' &&
      node.getTypeArguments().length === 0
    ) {
      const args = node.getArguments();
      if (args.length > 0 && Node.isObjectLiteralExpression(args[0])) {
        objectProps = await parseSetupObjectProps(args[0], importedObjectRefs, visitedImports);
      }
    }
  }

  if (objectProps !== null) {
    return objectProps;
  }

  // No defineProps found in setup script
  return null;
}

function extractGenericProps(typeText: string): RawPropDefinition[] {
  const project = new Project({
    compilerOptions: {
      strict: true,
      target: 99,
      module: 99,
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  // Wrap in a type alias so we can resolve it
  const sf = project.createSourceFile('__props__.ts', `type __Props__ = ${typeText};`);
  const typeAlias = sf.getTypeAlias('__Props__');
  if (!typeAlias) return [];

  const type = typeAlias.getType();
  const props: RawPropDefinition[] = [];

  for (const property of type.getProperties()) {
    const name = property.getName();
    const decl = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!decl) continue;

    const propType = property.getTypeAtLocation(decl);
    // Strip `| undefined` from optional types for clean output
    let resolvedTypeText = propType.getText(decl);
    if (property.isOptional()) {
      resolvedTypeText = resolvedTypeText.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, '');
    }

    props.push({
      name,
      type: resolvedTypeText,
      required: !property.isOptional(),
    });
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

function collectSetupImportedObjectRefs(
  sf: import('ts-morph').SourceFile,
  filePath: string,
): Map<string, SetupImportedObjectRef> {
  const refs = new Map<string, SetupImportedObjectRef>();

  for (const importDecl of sf.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (!specifier.startsWith('.')) continue;

    const resolvedImportPath = resolveLocalScriptModule(filePath, specifier);
    if (!resolvedImportPath) continue;

    for (const namedImport of importDecl.getNamedImports()) {
      refs.set(namedImport.getAliasNode()?.getText() ?? namedImport.getName(), {
        filePath: resolvedImportPath,
        exportName: namedImport.getName(),
      });
    }
  }

  return refs;
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

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

async function parseSetupObjectProps(
  obj: import('ts-morph').ObjectLiteralExpression,
  importedObjectRefs: Map<string, SetupImportedObjectRef>,
  visitedImports: Set<string>,
): Promise<RawPropDefinition[]> {
  const mergedProps = new Map<string, RawPropDefinition>();

  for (const prop of parseObjectProps(obj)) {
    mergedProps.set(prop.name, prop);
  }

  for (const prop of obj.getProperties()) {
    if (!Node.isSpreadAssignment(prop)) continue;

    const expression = prop.getExpression();
    if (!Node.isIdentifier(expression)) continue;

    const importedRef = importedObjectRefs.get(expression.getText());
    if (!importedRef) continue;

    const importedProps = await extractNamedObjectExportProps(importedRef, visitedImports);
    for (const importedProp of importedProps) {
      if (!mergedProps.has(importedProp.name)) {
        mergedProps.set(importedProp.name, importedProp);
      }
    }
  }

  return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function extractNamedObjectExportProps(
  importedRef: SetupImportedObjectRef,
  visitedImports: Set<string>,
): Promise<RawPropDefinition[]> {
  const visitKey = `${importedRef.filePath}:${importedRef.exportName}`;
  if (visitedImports.has(visitKey)) return [];
  visitedImports.add(visitKey);

  const source = await readFile(importedRef.filePath, 'utf-8');
  const project = new Project({
    compilerOptions: {
      strict: false,
      target: 99,
      module: 99,
      allowJs: true,
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__imported_object__.ts', source);
  for (const declaration of sf.getVariableDeclarations()) {
    if (declaration.getName() !== importedRef.exportName) continue;

    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isObjectLiteralExpression(initializer)) continue;

    return parseObjectProps(initializer);
  }

  return [];
}

/**
 * Resolve a bare module specifier (e.g. "primevue/select", "@primevue/core/baseeditableholder")
 * to a .vue source file within the same monorepo workspace.
 *
 * Strategy:
 * 1. Walk up from the importing file to find the monorepo root (directory with a
 *    root package.json that contains "workspaces" or a pnpm-workspace.yaml).
 * 2. Scan workspace package directories for a package.json whose "name" matches
 *    the package portion of the specifier.
 * 3. Use the package.json "exports" field (or "main") to resolve the subpath to
 *    an absolute .vue file path.
 */
const workspaceRootCache = new Map<string, string | null>();

function findWorkspaceRoot(startDir: string): string | null {
  if (workspaceRootCache.has(startDir)) return workspaceRootCache.get(startDir)!;

  let dir = startDir;
  while (true) {
    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkg.workspaces || existsSync(join(dir, 'pnpm-workspace.yaml'))) {
          workspaceRootCache.set(startDir, dir);
          return dir;
        }
      } catch {
        /* skip malformed */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      workspaceRootCache.set(startDir, null);
      return null;
    }
    dir = parent;
  }
}

const workspacePackageDirsCache = new Map<string, Map<string, string>>();

function getWorkspacePackageDirs(workspaceRoot: string): Map<string, string> {
  if (workspacePackageDirsCache.has(workspaceRoot)) {
    return workspacePackageDirsCache.get(workspaceRoot)!;
  }

  const packageMap = new Map<string, string>();
  const packagesDir = join(workspaceRoot, 'packages');

  if (!existsSync(packagesDir)) {
    workspacePackageDirsCache.set(workspaceRoot, packageMap);
    return packageMap;
  }

  function scanDir(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const pkgJsonPath = join(dir, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (typeof pkg.name === 'string') {
          packageMap.set(pkg.name, dir);
        }
      } catch {
        /* skip */
      }
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry.startsWith('.')) continue;
      const entryPath = join(dir, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory()) {
          scanDir(entryPath, depth + 1);
        }
      } catch {
        /* skip */
      }
    }
  }

  scanDir(packagesDir, 0);
  workspacePackageDirsCache.set(workspaceRoot, packageMap);
  return packageMap;
}

function resolveWorkspaceVueImport(specifier: string, importingFilePath: string): string | null {
  const workspaceRoot = findWorkspaceRoot(dirname(importingFilePath));
  if (!workspaceRoot) return null;

  const packageDirs = getWorkspacePackageDirs(workspaceRoot);

  // Parse the specifier into package name and subpath
  // e.g. "primevue/select" → packageName="primevue", subpath="./select"
  // e.g. "@primevue/core/baseeditableholder" → packageName="@primevue/core", subpath="./baseeditableholder"
  let packageName: string;
  let subpath: string;

  if (specifier.startsWith('@')) {
    // Scoped package: @scope/name or @scope/name/subpath
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    packageName = `${parts[0]}/${parts[1]}`;
    subpath = parts.length > 2 ? './' + parts.slice(2).join('/') : '.';
  } else {
    const slashIndex = specifier.indexOf('/');
    if (slashIndex === -1) {
      packageName = specifier;
      subpath = '.';
    } else {
      packageName = specifier.substring(0, slashIndex);
      subpath = './' + specifier.substring(slashIndex + 1);
    }
  }

  const packageDir = packageDirs.get(packageName);
  if (!packageDir) return null;

  // Try package.json exports field first
  const pkgJsonPath = join(packageDir, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

    if (pkg.exports && subpath !== '.') {
      const exportValue = pkg.exports[subpath];
      if (typeof exportValue === 'string' && exportValue.endsWith('.vue')) {
        const resolved = resolve(packageDir, exportValue);
        if (existsSync(resolved)) return resolved;
      }
    }

    // Try subpath as a directory with its own package.json
    if (subpath !== '.') {
      const subDir = resolve(packageDir, subpath.replace(/^\.\//, ''));
      // Check in src/ first (common pattern)
      for (const base of [join(packageDir, 'src', subpath.replace(/^\.\//, '')), subDir]) {
        const subPkgPath = join(base, 'package.json');
        if (existsSync(subPkgPath)) {
          try {
            const subPkg = JSON.parse(readFileSync(subPkgPath, 'utf8'));
            const main = subPkg.main || subPkg.module;
            if (typeof main === 'string' && main.endsWith('.vue')) {
              const resolved = resolve(base, main);
              if (existsSync(resolved)) return resolved;
            }
          } catch {
            /* skip */
          }
        }
      }
    }

    // Fallback: try main/module field for root imports
    if (subpath === '.') {
      const main = pkg.main || pkg.module;
      if (typeof main === 'string' && main.endsWith('.vue')) {
        const resolved = resolve(packageDir, main);
        if (existsSync(resolved)) return resolved;
      }
    }
  } catch {
    /* skip malformed */
  }

  return null;
}

async function extractOptionsProps(
  filePath: string,
  scriptContent: string,
  visited: Set<string> = new Set(),
): Promise<RawPropDefinition[]> {
  const resolvedFilePath = resolve(filePath);
  if (visited.has(resolvedFilePath)) {
    return [];
  }
  visited.add(resolvedFilePath);

  const project = new Project({
    compilerOptions: {
      strict: false,
      target: 99,
      module: 99,
      allowJs: true,
    },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__options__.ts', scriptContent);
  const localImports = new Map<string, string>();
  for (const importDecl of sf.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const defaultImport = importDecl.getDefaultImport();
    if (!defaultImport) continue;

    if (specifier.startsWith('.')) {
      if (!specifier.endsWith('.vue')) continue;
      localImports.set(defaultImport.getText(), resolve(dirname(resolvedFilePath), specifier));
    } else {
      // Try resolving bare module specifier to a .vue file in the workspace
      const resolvedVuePath = resolveWorkspaceVueImport(specifier, resolvedFilePath);
      if (resolvedVuePath) {
        localImports.set(defaultImport.getText(), resolvedVuePath);
      }
    }
  }

  for (const node of sf.getDescendants()) {
    if (!Node.isExportAssignment(node)) continue;
    const expr = node.getExpression();
    if (!Node.isObjectLiteralExpression(expr)) continue;

    const mergedProps = new Map<string, RawPropDefinition>();
    const extendsProp = expr.getProperty('extends');
    if (extendsProp && Node.isPropertyAssignment(extendsProp)) {
      const extendsInit = extendsProp.getInitializer();
      if (extendsInit && Node.isIdentifier(extendsInit)) {
        const extendsPath = localImports.get(extendsInit.getText());
        if (extendsPath) {
          const inheritedProps = await extractInheritedVueProps(extendsPath, visited);
          for (const prop of inheritedProps) {
            mergedProps.set(prop.name, prop);
          }
        }
      }
    }

    const propsProp = expr.getProperty('props');
    if (!propsProp || !Node.isPropertyAssignment(propsProp)) {
      return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    const propsInit = propsProp.getInitializer();
    if (!propsInit || !Node.isObjectLiteralExpression(propsInit)) {
      return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    for (const prop of parseObjectProps(propsInit)) {
      mergedProps.set(prop.name, prop);
    }

    return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
}

async function extractInheritedVueProps(filePath: string, visited: Set<string>): Promise<RawPropDefinition[]> {
  const source = await readFile(filePath, 'utf-8');
  const { descriptor } = parseSFC(source);
  if (!descriptor.script) {
    return [];
  }

  return extractOptionsProps(filePath, descriptor.script.content, visited);
}

function parseObjectProps(obj: import('ts-morph').ObjectLiteralExpression): RawPropDefinition[] {
  if (!Node.isObjectLiteralExpression(obj)) return [];

  const result: RawPropDefinition[] = [];

  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const name = prop.getName();
    if (!isPublicVuePropName(name)) continue;
    const init = prop.getInitializer();

    if (!init || !Node.isObjectLiteralExpression(init)) {
      // Bare constructor reference like `propName: String`
      const initText = init?.getText() ?? 'any';
      result.push({
        name,
        type: VUE_TYPE_MAP[initText] ?? 'any',
        required: false,
      });
      continue;
    }

    // { type: X, required: bool, default: val }
    const typeProp = init.getProperty('type');
    const requiredProp = init.getProperty('required');
    const defaultProp = init.getProperty('default');

    let type = 'any';
    if (typeProp && Node.isPropertyAssignment(typeProp)) {
      const typeInit = typeProp.getInitializer();
      if (typeInit) {
        type = VUE_TYPE_MAP[typeInit.getText()] ?? 'any';
      }
    }

    let required = false;
    if (requiredProp && Node.isPropertyAssignment(requiredProp)) {
      const reqInit = requiredProp.getInitializer();
      if (reqInit) {
        required = reqInit.getText() === 'true';
      }
    }

    let defaultValue: string | undefined;
    if (defaultProp && Node.isPropertyAssignment(defaultProp)) {
      const defInit = defaultProp.getInitializer();
      if (defInit) {
        defaultValue = defInit.getText().replace(/^['"]|['"]$/g, '');
      }
    }

    result.push({
      name,
      type,
      required,
      ...(defaultValue !== undefined && { defaultValue }),
    });
  }

  return result;
}

function isPublicVuePropName(name: string): boolean {
  return !/^[_$]/.test(name);
}

function extractSlotsFromTemplate(ast: TemplateAstNode): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  function walk(node: TemplateAstNode): void {
    if (node.type === ELEMENT_TYPE && node.tag === 'slot') {
      const nameProp = node.props?.find((p) => p.type === ATTRIBUTE_TYPE && p.name === 'name');
      const slotName = nameProp?.value?.content ?? 'default';
      const isDefault = slotName === 'default';
      if (!slots.some((s) => s.name === slotName)) {
        slots.push({ name: slotName, isDefault });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          walk(child as TemplateAstNode);
        }
      }
    }
  }

  walk(ast);
  return slots;
}

/**
 * Detect slots referenced via runtime `$slots.name` or `$slots['name']` access
 * in template expressions or script content that aren't declared as `<slot>` tags.
 */
function extractSlotsFromRuntimeAccess(source: string): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];
  const seen = new Set<string>();

  // Match $slots.name (dot access) and $slots['name'] / $slots["name"] (bracket access)
  const dotPattern = /\$slots\.([a-zA-Z_]\w*)/g;
  const bracketPattern = /\$slots\[['"]([a-zA-Z_][\w-]*)['"]\]/g;

  for (const pattern of [dotPattern, bracketPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      if (!seen.has(name)) {
        seen.add(name);
        slots.push({ name, isDefault: name === 'default' });
      }
    }
  }

  return slots;
}

function mergeSlotsDedup(base: RawSlotDefinition[], extra: RawSlotDefinition[]): RawSlotDefinition[] {
  const merged = [...base];
  for (const slot of extra) {
    if (!merged.some((s) => s.name === slot.name)) {
      merged.push(slot);
    }
  }
  return merged;
}
