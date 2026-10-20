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
import { describeSourceDomain } from '../../../candidates/source-candidates.js';
import {
  isVueMacroCall,
  readVueRuntimeProps,
  vueComponentOptions,
  vueDiagnostic,
  vueLocation,
  vuePropertyName,
  vueSyntax,
  type VueReaderContext,
} from './read-vue-runtime.js';
import { readVueSlots } from './read-vue-slots.js';

const VIRTUAL_SUFFIX = '.source-evidence.ts';
const MAX_IMPORTED_VUE_DEPTH = 64;
const MAX_IMPORTED_VUE_FILES = 256;
const MAX_IMPORTED_VUE_FILE_BYTES = 256 * 1024;
const MAX_IMPORTED_VUE_BYTES = 16 * 1024 * 1024;

export interface VueSfcCompilerInput {
  filePath: string;
  scriptContent: string;
  source?: string;
}

export interface VueSfcCompilerContexts {
  projectBySfcPath: ReadonlyMap<string, Project>;
  diagnostics: ExtractionDiagnostics;
}

export function virtualScriptPath(filePath: string): string {
  return `${resolve(filePath)}${VIRTUAL_SUFFIX}`;
}

/** Preserve every source line and UTF-16 offset while exposing both SFC script blocks. */
export function vueScriptSource(source: string): string {
  const { descriptor } = parseSFC(source);
  const chunks = source.split('');
  for (let index = 0; index < chunks.length; index++) {
    if (chunks[index] !== '\n' && chunks[index] !== '\r') chunks[index] = ' ';
  }
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    for (let index = 0; index < block.content.length; index++)
      chunks[block.loc.start.offset + index] = block.content[index]!;
  }
  return chunks.join('');
}

/** Build one bounded configured context for the actual Vue script roots in an extraction run. */
export function createVueSfcCompilerContexts(
  inputs: readonly VueSfcCompilerInput[],
  options: ExtractorOptions = {},
): VueSfcCompilerContexts {
  const virtualSources = inputs.map((input) => ({
    path: virtualScriptPath(input.filePath),
    content: input.source === undefined ? input.scriptContent : vueScriptSource(input.source),
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
  props: RawPropDefinition[];
  slots: RawSlotDefinition[];
  name?: string;
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
  for (const owner of vueComponentOptions(sourceFile)) {
    const property = owner.getProperty('props');
    if (!property || !Node.isPropertyAssignment(property)) continue;
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
        startOffset: propNode.getStart(),
        endOffset: propNode.getEnd(),
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
      project.getSourceFile(virtualPath) ??
      project.createSourceFile(virtualPath, vueScriptSource(source), { overwrite: true });
    const inherited = collectImportedOptionsProps(importedSourceFile, project, diagnostics, visited);
    const local = localOptionsProps(importedSourceFile);
    const propsByName = new Map(inherited.props.map((prop) => [prop.name, prop]));
    const defaults = new Map(inherited.defaults);
    const locations = new Map(inherited.locations);
    const keyAliases = new Map(inherited.keyAliases);
    const lineOffset = 0;
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
  _scriptOffset: number,
  projectedProps: readonly RawPropDefinition[],
  _slots: readonly RawSlotDefinition[],
  options: ExtractorOptions = {},
  compiler?: { project?: Project; diagnostics: ExtractionDiagnostics },
): VueSourceCandidateResult {
  const canonicalSfcPath = resolve(filePath);
  const virtualPath = virtualScriptPath(canonicalSfcPath);
  const localContext = compiler
    ? undefined
    : createVueSfcCompilerContexts([{ filePath, scriptContent, source }], options);
  const project = compiler?.project ?? localContext?.projectBySfcPath.get(canonicalSfcPath);
  const diagnostics = compiler?.diagnostics ?? localContext!.diagnostics;
  const sourceFile = project?.getSourceFile(virtualPath);
  const observations = [] as ReturnType<typeof observeRawProps>;
  const context: VueReaderContext = { sourcePath: canonicalSfcPath, source, diagnostics, occurrence: 0 };
  const propsByName = new Map(projectedProps.map((prop) => [prop.name, prop]));
  let name: string | undefined;
  let propsDeclarations = 0;
  const { descriptor } = parseSFC(source);

  if (sourceFile) {
    const inherited = collectImportedOptionsProps(sourceFile, project!, diagnostics);
    observations.push(
      ...observeRawProps(inherited.props, 'declaration', {
        origin: 'imported',
        sourceDefaults: inherited.defaults,
        locations: inherited.locations,
      }),
    );
    for (const prop of inherited.props) propsByName.set(prop.name, prop);
    for (const owner of vueComponentOptions(sourceFile, context)) {
      const nameProperty = owner.getProperty('name');
      const initializer =
        nameProperty && Node.isPropertyAssignment(nameProperty) ? nameProperty.getInitializer() : undefined;
      if (initializer && Node.isStringLiteral(initializer)) name = initializer.getLiteralValue();
      const property = owner.getProperty('props');
      if (property && Node.isPropertyAssignment(property)) {
        propsDeclarations++;
        const expression = property.getInitializer();
        if (expression) {
          const result = readVueRuntimeProps(expression, context);
          observations.push(...result.observations);
          for (const prop of result.props) propsByName.set(prop.name, prop);
          vueDiagnostic(
            context,
            `vue-props-${result.resolution === 'resolved' ? (result.props.length ? 'resolved' : 'empty') : result.resolution}`,
            property,
            result.resolution === 'resolved',
          );
        } else vueDiagnostic(context, 'vue-props-unresolved', property);
      }
    }
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== 'defineProps') continue;
      if (!isVueMacroCall(call, context)) continue;
      if (
        call.getFirstAncestor(
          (node) => Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node),
        )
      )
        continue;
      propsDeclarations++;
      const typeArgument = call.getTypeArguments()[0];
      if (!typeArgument) {
        const expression = call.getArguments()[0];
        if (!expression) {
          vueDiagnostic(context, 'vue-props-unresolved', call);
          continue;
        }
        const result = readVueRuntimeProps(expression, context);
        observations.push(...result.observations);
        for (const prop of result.props) propsByName.set(prop.name, prop);
        vueDiagnostic(
          context,
          `vue-props-${result.resolution === 'resolved' ? (result.props.length ? 'resolved' : 'empty') : result.resolution}`,
          call,
          result.resolution === 'resolved',
        );
        continue;
      }
      try {
        const type = typeArgument.getType();
        if (type.isAny() || type.isUnknown() || type.isNever()) {
          vueDiagnostic(context, 'vue-props-unresolved', typeArgument);
          continue;
        }
        const props = typeProps(type);
        const defaults = new Map<string, import('ts-morph').Node>();
        const parent = call.getParent();
        if (
          Node.isCallExpression(parent) &&
          parent.getExpression().getText() === 'withDefaults' &&
          parent.getArguments()[0] === call &&
          isVueMacroCall(parent, context)
        ) {
          const values = parent.getArguments()[1];
          if (values && Node.isObjectLiteralExpression(values)) {
            for (const property of values.getProperties()) {
              if (!Node.isPropertyAssignment(property)) continue;
              const key = vuePropertyName(property.getNameNode());
              const initializer = property.getInitializer();
              if (key !== undefined && initializer) defaults.set(key, initializer);
            }
          } else vueDiagnostic(context, 'vue-defaults-unresolved', parent);
        }
        const variable = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        const binding = variable?.getNameNode();
        if (binding && Node.isObjectBindingPattern(binding)) {
          for (const element of binding.getElements()) {
            const key = vuePropertyName(element.getPropertyNameNode() ?? element.getNameNode());
            const initializer = element.getInitializer();
            if (key !== undefined && initializer) defaults.set(key, initializer);
          }
        }
        const observed = observeTypeProps(type, props, virtualPath, {
          sourceDefaults: new Map([...defaults].map(([key, node]) => [key, node.getText()])),
          virtualSource: {
            path: virtualPath,
            originalPath: canonicalSfcPath,
            sourceHash: createHash('sha256').update(source).digest('hex'),
            lineOffset: 0,
          },
        });
        for (const observation of observed) {
          const defaultNode = defaults.get(observation.name);
          const syntax = vueSyntax(context, 'prop', call.getText(), defaultNode);
          syntax.typeLocations = [vueLocation(typeArgument, context)];
          if (observation.fact) {
            observation.fact.domain = describeSourceDomain(observation.type);
            if (observation.fact.sourceDefault)
              observation.fact.sourceDefault.location = defaultNode ? vueLocation(defaultNode, context) : null;
          }
          observations.push({ ...observation, syntax });
        }
        for (const prop of props)
          propsByName.set(prop.name, {
            ...prop,
            type: prop.type.replace(/\s*\|\s*undefined$/, '').replace(/^undefined\s*\|\s*/, ''),
            ...(defaults.has(prop.name) ? { defaultValue: defaults.get(prop.name)!.getText() } : {}),
          });
        const partial =
          type.isUnion() ||
          Boolean(type.getStringIndexType() || type.getNumberIndexType()) ||
          observed.some((observation) => observation.type === 'unknown' || observation.type === 'any');
        const empty =
          !props.length && !partial && (type.getText(typeArgument) === '{}' || Node.isTypeLiteral(typeArgument));
        vueDiagnostic(
          context,
          `vue-props-${partial ? 'partial' : props.length ? 'resolved' : empty ? 'empty' : 'unresolved'}`,
          typeArgument,
          !partial && (props.length > 0 || empty),
        );
      } catch {
        vueDiagnostic(context, 'vue-props-throw', typeArgument);
      }
    }
  }
  if (!propsDeclarations) vueDiagnostic(context, 'vue-props-absent', undefined, true);
  const slotResult = readVueSlots(sourceFile, context, descriptor.template?.ast);
  observations.push(...slotResult.observations);
  const props = [...propsByName.values()]
    .filter((prop) => !/^[_$]/.test(prop.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const collection = mergeSourceCandidates(observations, props, slotResult.slots);
  if (collection.omittedCount) vueDiagnostic(context, 'vue-source-candidate-budget-exhausted');
  return {
    sourceCandidates: collection.candidates,
    factSchemaVersion: SOURCE_FACT_SCHEMA_VERSION,
    diagnostics,
    props,
    slots: slotResult.slots,
    ...(name ? { name } : {}),
  };
}
