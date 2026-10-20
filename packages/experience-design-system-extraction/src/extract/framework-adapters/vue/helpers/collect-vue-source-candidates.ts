import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Node, SyntaxKind, type Project } from 'ts-morph';
import { parse as parseSFC } from '@vue/compiler-sfc';
import type { RawComponentDefinition, RawPropDefinition, RawSlotDefinition } from '../../../types/component.js';
import type { ExtractorOptions } from '../../../types/options.js';
import { mergeSourceCandidates, observeRawProps, observeTypeProps } from '../../../candidates/source-candidates.js';
import { SOURCE_FACT_SCHEMA_VERSION, type ExtractionDiagnostics } from '../../../candidates/types.js';
import { createCompilerContexts, type CompilerContextResult } from '../../../compiler/context.js';
import { parseVueObjectProps } from './extract-vue-object-props.js';

const VIRTUAL_SUFFIX = '.source-evidence.ts';
const MAX_IMPORTED_VUE_DEPTH = 64;
const MAX_IMPORTED_VUE_FILES = 256;
const MAX_IMPORTED_VUE_FILE_BYTES = 256 * 1024;
const MAX_IMPORTED_VUE_BYTES = 16 * 1024 * 1024;

export interface VueSfcCompilerInput {
  filePath: string;
  scriptContent: string;
}

export interface VueSfcCompilerContexts {
  projectBySfcPath: ReadonlyMap<string, Project>;
  diagnostics: ExtractionDiagnostics;
}

function virtualScriptPath(filePath: string): string {
  return `${resolve(filePath)}${VIRTUAL_SUFFIX}`;
}

/** Build one bounded configured context for the actual Vue script roots in an extraction run. */
export function createVueSfcCompilerContexts(
  inputs: readonly VueSfcCompilerInput[],
  options: ExtractorOptions = {},
): VueSfcCompilerContexts {
  const virtualSources = inputs.map((input) => ({
    path: virtualScriptPath(input.filePath),
    content: input.scriptContent,
  }));
  const result: CompilerContextResult = createCompilerContexts(
    virtualSources.map((source) => source.path),
    /\.vue\.source-evidence\.ts$/,
    options,
    virtualSources,
  );
  const projectBySfcPath = new Map<string, Project>();
  for (const input of inputs) {
    const path = virtualScriptPath(input.filePath);
    const context = result.contexts.find((candidate) => candidate.assignedFiles.includes(path));
    if (context) projectBySfcPath.set(resolve(input.filePath), context.project);
  }
  return { projectBySfcPath, diagnostics: result.diagnostics };
}

export interface VueSourceCandidateResult {
  sourceCandidates: NonNullable<RawComponentDefinition['sourceCandidates']>;
  factSchemaVersion: number;
  diagnostics: ExtractionDiagnostics;
}

function initializerSourceDefaults(sourceFile: import('ts-morph').SourceFile): Map<string, string> {
  const defaults = new Map<string, string>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'withDefaults') continue;
    const values = call.getArguments()[1];
    if (!values || !Node.isObjectLiteralExpression(values)) continue;
    for (const property of values.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;
      const initializer = property.getInitializer();
      if (initializer) defaults.set(property.getName(), initializer.getText());
    }
  }
  return defaults;
}

function sourcePropertyName(property: import('ts-morph').PropertyAssignment): string {
  const name = property.getNameNode();
  const expression = Node.isComputedPropertyName(name) ? name.getExpression() : name;
  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression))
    return expression.getLiteralValue();
  if (Node.isNumericLiteral(expression)) return String(expression.getLiteralValue());
  return property.getName();
}

function localOptionsProps(sourceFile: import('ts-morph').SourceFile): {
  props: RawPropDefinition[];
  defaults: Map<string, string>;
  locations: Map<string, NonNullable<import('../../../candidates/types.js').SourceFactLocation>>;
  keyAliases: Map<string, string>;
} {
  const props: RawPropDefinition[] = [];
  const defaults = new Map<string, string>();
  const locations = new Map<string, NonNullable<import('../../../candidates/types.js').SourceFactLocation>>();
  const keyAliases = new Map<string, string>();
  for (const property of sourceFile.getDescendants()) {
    if (!Node.isPropertyAssignment(property) || property.getName() !== 'props') continue;
    const initializer = property.getInitializer();
    if (!initializer || !Node.isObjectLiteralExpression(initializer)) continue;
    const parsedProps = new Map(parseVueObjectProps(initializer, true).map((prop) => [prop.name, prop]));
    for (const propNode of initializer.getProperties()) {
      if (!Node.isPropertyAssignment(propNode)) continue;
      const name = sourcePropertyName(propNode);
      keyAliases.set(propNode.getName(), name);
      const parsedProp = parsedProps.get(propNode.getName());
      if (parsedProp) props.push({ ...parsedProp, name });
      const startLine = propNode.getStartLineNumber();
      const endLine = propNode.getEndLineNumber();
      locations.set(name, {
        fileId: null,
        canonicalPath: resolve(sourceFile.getFilePath()),
        textHash: createHash('sha256').update(sourceFile.getFullText()).digest('hex'),
        startLine,
        endLine,
        binding: 'unverified',
      });
      const option = propNode.getInitializer();
      if (!option || !Node.isObjectLiteralExpression(option)) continue;
      const defaultProperty = option.getProperty('default');
      if (defaultProperty && Node.isPropertyAssignment(defaultProperty)) {
        const defaultInitializer = defaultProperty.getInitializer();
        if (defaultInitializer) defaults.set(name, defaultInitializer.getText());
      }
    }
  }
  return { props, defaults, locations, keyAliases };
}

type VueOptionsSource = ReturnType<typeof localOptionsProps>;

function collectImportedOptionsProps(
  sourceFile: import('ts-morph').SourceFile,
  project: Project,
  diagnostics: ExtractionDiagnostics,
  visited = new Set<string>(),
): VueOptionsSource {
  const empty: VueOptionsSource = { props: [], defaults: new Map(), locations: new Map(), keyAliases: new Map() };
  diagnostics.limits.maxVueImportedDepth ??= MAX_IMPORTED_VUE_DEPTH;
  diagnostics.limits.maxVueImportedFiles ??= MAX_IMPORTED_VUE_FILES;
  diagnostics.limits.maxVueImportedFileBytes ??= MAX_IMPORTED_VUE_FILE_BYTES;
  diagnostics.limits.maxVueImportedBytes ??= MAX_IMPORTED_VUE_BYTES;
  diagnostics.used.vueImportedFiles ??= 0;
  diagnostics.used.vueImportedBytes ??= 0;

  const currentPath = sourceFile.getFilePath().replace(VIRTUAL_SUFFIX, '');
  const imports = new Map<string, string>();
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const defaultImport = importDeclaration.getDefaultImport();
    const specifier = importDeclaration.getModuleSpecifierValue();
    if (defaultImport && specifier.startsWith('.') && specifier.endsWith('.vue')) {
      imports.set(defaultImport.getText(), resolve(dirname(currentPath), specifier));
    }
  }
  const extendsNode = sourceFile.getDescendants().find((node) => {
    if (!Node.isPropertyAssignment(node) || node.getName() !== 'extends') return false;
    const initializer = node.getInitializer();
    return Boolean(initializer && Node.isIdentifier(initializer) && imports.has(initializer.getText()));
  });
  if (!extendsNode || !Node.isPropertyAssignment(extendsNode)) return empty;
  const initializer = extendsNode.getInitializer();
  if (!initializer || !Node.isIdentifier(initializer)) return empty;
  const importedPath = imports.get(initializer.getText());
  if (!importedPath) return empty;
  const recordUnavailable = (reason: string) => {
    diagnostics.modules.push({
      specifier: initializer.getText(),
      fromPath: currentPath,
      outcome: 'unavailable',
      reason,
    });
  };
  if (visited.has(importedPath)) {
    recordUnavailable('vue-options-extends-cycle');
    return empty;
  }
  if (visited.size >= MAX_IMPORTED_VUE_DEPTH) {
    recordUnavailable('vue-options-extends-depth-budget-exhausted');
    return empty;
  }
  if (diagnostics.used.vueImportedFiles >= MAX_IMPORTED_VUE_FILES) {
    recordUnavailable('vue-imported-file-budget-exhausted');
    return empty;
  }
  visited.add(importedPath);

  try {
    const stat = statSync(importedPath);
    if (!stat.isFile()) {
      recordUnavailable('vue-imported-file-unavailable');
      return empty;
    }
    if (
      stat.size > MAX_IMPORTED_VUE_FILE_BYTES ||
      diagnostics.used.vueImportedBytes + stat.size > MAX_IMPORTED_VUE_BYTES
    ) {
      recordUnavailable('vue-imported-file-byte-budget-exhausted');
      return empty;
    }
    const source = readFileSync(importedPath, 'utf8');
    const sourceBytes = Buffer.byteLength(source, 'utf8');
    if (
      sourceBytes > MAX_IMPORTED_VUE_FILE_BYTES ||
      diagnostics.used.vueImportedBytes + sourceBytes > MAX_IMPORTED_VUE_BYTES
    ) {
      recordUnavailable('vue-imported-file-byte-budget-exhausted');
      return empty;
    }
    diagnostics.used.vueImportedFiles += 1;
    diagnostics.used.vueImportedBytes += sourceBytes;
    const { descriptor } = parseSFC(source);
    const script = descriptor.scriptSetup ?? descriptor.script;
    if (!script) return empty;
    const virtualPath = virtualScriptPath(importedPath);
    const importedSourceFile =
      project.getSourceFile(virtualPath) ?? project.createSourceFile(virtualPath, script.content, { overwrite: true });
    const inherited = collectImportedOptionsProps(importedSourceFile, project, diagnostics, visited);
    const local = localOptionsProps(importedSourceFile);
    const propsByName = new Map(inherited.props.map((prop) => [prop.name, prop]));
    const defaults = new Map(inherited.defaults);
    const locations = new Map(inherited.locations);
    const keyAliases = new Map(inherited.keyAliases);
    const lineOffset = source.slice(0, script.loc.start.offset).split('\n').length - 1;
    const sourceHash = createHash('sha256').update(source).digest('hex');
    for (const [name, location] of local.locations) {
      local.locations.set(name, {
        ...location,
        canonicalPath: resolve(importedPath),
        textHash: sourceHash,
        startLine: location.startLine === null ? null : location.startLine + lineOffset,
        endLine: location.endLine === null ? null : location.endLine + lineOffset,
      });
    }
    for (const prop of local.props) propsByName.set(prop.name, prop);
    for (const [name, expression] of local.defaults) defaults.set(name, expression);
    for (const [name, location] of local.locations) locations.set(name, location);
    for (const [syntaxName, name] of local.keyAliases) keyAliases.set(syntaxName, name);
    return { props: [...propsByName.values()], defaults, locations, keyAliases };
  } catch {
    recordUnavailable('vue-imported-file-read-or-parse-failed');
    return empty;
  }
}

function typeProps(type: import('ts-morph').Type): RawPropDefinition[] {
  return type.getProperties().map((property) => {
    const declaration = property.getDeclarations()[0];
    const at = declaration ?? type.getSymbol()?.getDeclarations()[0];
    let typeText = 'unknown';
    if (at) {
      try {
        typeText = property.getTypeAtLocation(at).getText(at);
      } catch {
        typeText = 'unknown';
      }
    }
    return { name: property.getName(), type: typeText, required: !property.isOptional() };
  });
}

/** Capture actual Vue SFC script declarations through the shared configured compiler owner. */
export function collectVueSourceCandidates(
  filePath: string,
  source: string,
  scriptContent: string,
  scriptOffset: number,
  projectedProps: readonly RawPropDefinition[],
  slots: readonly RawSlotDefinition[],
  options: ExtractorOptions = {},
  compiler?: { project?: Project; diagnostics: ExtractionDiagnostics },
): VueSourceCandidateResult {
  const canonicalSfcPath = resolve(filePath);
  const virtualPath = virtualScriptPath(canonicalSfcPath);
  const localContext = compiler
    ? undefined
    : createCompilerContexts(
        [virtualPath],
        /\.vue\.source-evidence\.ts$/,
        { ...options, projectRoot: options.projectRoot ?? dirname(canonicalSfcPath) },
        [{ path: virtualPath, content: scriptContent }],
      );
  const sourceFile = (compiler?.project ?? localContext?.contexts[0]?.project)?.getSourceFile(virtualPath);
  const observations = [] as ReturnType<typeof observeRawProps>;
  const sfcHash = createHash('sha256').update(source).digest('hex');
  const lineOffset = source.slice(0, scriptOffset).split('\n').length - 1;
  const sourceDefaults = new Map<string, string>();
  const keyAliases = new Map<string, string>();

  if (sourceFile) {
    const optionsProps = localOptionsProps(sourceFile);
    const typedCall = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
      const expression = call.getExpression();
      return (
        Node.isIdentifier(expression) && expression.getText() === 'defineProps' && call.getTypeArguments().length > 0
      );
    });
    const typeArgument = typedCall?.getTypeArguments()[0];
    if (typeArgument) {
      const type = typeArgument.getType();
      const props = typeProps(type);
      const defaults = initializerSourceDefaults(sourceFile);
      for (const [name, expression] of defaults) sourceDefaults.set(name, expression);
      observations.push(
        ...observeTypeProps(type, props, virtualPath, {
          sourceDefaults: defaults,
          virtualSource: {
            path: virtualPath,
            originalPath: canonicalSfcPath,
            sourceHash: sfcHash,
            lineOffset,
          },
        }),
      );
    }
    for (const [name, expression] of optionsProps.defaults) sourceDefaults.set(name, expression);
    const importedOptions = collectImportedOptionsProps(
      sourceFile,
      sourceFile.getProject(),
      compiler?.diagnostics ?? localContext!.diagnostics,
    );
    for (const [syntaxName, name] of importedOptions.keyAliases) keyAliases.set(syntaxName, name);
    for (const [syntaxName, name] of optionsProps.keyAliases) keyAliases.set(syntaxName, name);
    const localOptionNames = new Set(optionsProps.props.map((prop) => prop.name));
    const importedEvidence = observeRawProps(importedOptions.props, 'runtime-object', {
      origin: 'imported',
      sourceDefaults: importedOptions.defaults,
      locations: importedOptions.locations,
    }).map((observation) => ({
      ...observation,
      evidenceKind: localOptionNames.has(observation.name) ? ('runtime-object' as const) : ('declaration' as const),
    }));
    observations.push(...importedEvidence);
    observations.push(
      ...observeRawProps(optionsProps.props, 'declaration', {
        origin: 'own',
        sourceDefaults: optionsProps.defaults,
        locations: new Map(
          [...optionsProps.locations].map(([name, location]) => [
            name,
            {
              ...location,
              canonicalPath: canonicalSfcPath,
              textHash: sfcHash,
              startLine: location.startLine === null ? null : location.startLine + lineOffset,
              endLine: location.endLine === null ? null : location.endLine + lineOffset,
            },
          ]),
        ),
      }),
    );
  }

  observations.push(
    ...observeRawProps(
      projectedProps.map((prop) => ({ ...prop, name: keyAliases.get(prop.name) ?? prop.name })),
      'runtime-object',
      { sourceDefaults },
    ),
  );
  const collection = mergeSourceCandidates(observations, projectedProps, slots);
  return {
    sourceCandidates: collection.candidates,
    factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    diagnostics: compiler?.diagnostics ?? localContext!.diagnostics,
  };
}
