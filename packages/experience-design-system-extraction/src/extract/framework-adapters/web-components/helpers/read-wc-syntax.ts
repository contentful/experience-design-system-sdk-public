import { resolve } from 'node:path';
import {
  Node,
  SyntaxKind,
  type ClassDeclaration,
  type ClassExpression,
  type SourceFile,
  type ObjectLiteralExpression,
} from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../types/component.js';
import type {
  CompilerModuleDiagnostic,
  SourceCandidateObservation,
  WebComponentSyntaxObservation,
} from '../../../candidates/types.js';
import { createCompilerContexts } from '../../../compiler/context.js';
import type { ExtractorOptions } from '../../../types/options.js';
import { mergeSourceCandidates } from '../../../candidates/source-candidates.js';
import { resolveWcDomain, resolveWcValue, wcDeclarations, wcKey, wcLocation } from './read-wc-values.js';
import { extractSlotsFromTemplate } from './extract-wc-slots.js';

export type WebComponentClass = ClassDeclaration | ClassExpression;
const MAX_CLASS_DEPTH = 64;
const MAX_DECLARATIONS = 2048;

export function createWebComponentCompilerContexts(filePaths: readonly string[], options: ExtractorOptions = {}) {
  const result = createCompilerContexts(
    filePaths.filter((file) => /\.[jt]s$/.test(file) && !file.endsWith('.d.ts')),
    /\.[jt]s$/,
    options,
  );
  for (const context of result.contexts) context.project.compilerOptions.set({ allowJs: true, noEmit: true });
  for (const diagnostic of result.diagnostics.projects)
    diagnostic.options = { ...diagnostic.options, allowJs: true, noEmit: true };
  return result;
}

export function collectWebComponentClasses(sourceFile: SourceFile): { declaration: WebComponentClass; name: string }[] {
  const classes: { declaration: WebComponentClass; name: string }[] = sourceFile
    .getClasses()
    .flatMap((declaration) => (declaration.getName() ? [{ declaration, name: declaration.getName()! }] : []));
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (initializer && Node.isClassExpression(initializer))
      classes.push({ declaration: initializer, name: declaration.getName() });
  }
  return classes;
}

function optionsObject(node: Node | undefined): ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  if (Node.isObjectLiteralExpression(node)) return node;
  if (Node.isAsExpression(node) || Node.isParenthesizedExpression(node) || Node.isSatisfiesExpression(node))
    return optionsObject(node.getExpression());
  return undefined;
}

function metadataFor(
  name: string,
  options: Node | undefined,
  present: boolean,
  unknownStatic: boolean,
  exposure: string[],
): Pick<WebComponentSyntaxObservation, 'converter' | 'attribute' | 'reflect' | 'exposure'> {
  const object = optionsObject(options);
  const uncertain =
    (options !== undefined && !object) ||
    unknownStatic ||
    Boolean(object?.getProperties().some((item) => !Node.isPropertyAssignment(item)));
  const field = (key: string) =>
    object
      ?.getProperties()
      .reverse()
      .find((item) => Node.isPropertyAssignment(item) && wcKey(item.getNameNode()) === key)
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
  const converterNode = field('type');
  const converterExpression = converterNode?.getText() ?? null;
  const converter = {
    state: converterExpression
      ? ['String', 'Number', 'Boolean', 'Object', 'Array'].includes(converterExpression)
        ? ('known' as const)
        : ('unknown' as const)
      : uncertain
        ? ('unknown' as const)
        : ('absent' as const),
    expression: converterExpression,
  };
  const attributeNode = field('attribute');
  const attributeValue = resolveWcValue(attributeNode).value;
  const attribute: WebComponentSyntaxObservation['attribute'] = attributeNode
    ? attributeValue?.kind === 'string'
      ? { state: 'explicit', name: attributeValue.value }
      : attributeValue?.kind === 'boolean' && attributeValue.value === 'false'
        ? { state: 'disabled', name: null }
        : attributeValue?.kind === 'boolean' && attributeValue.value === 'true'
          ? { state: 'implicit', name: name.toLowerCase() }
          : { state: 'unknown', name: null }
    : uncertain
      ? { state: 'unknown', name: null }
      : present
        ? { state: 'implicit', name: name.toLowerCase() }
        : { state: 'absent', name: null };
  const reflectNode = field('reflect');
  const reflectValue = resolveWcValue(reflectNode).value;
  const reflect: WebComponentSyntaxObservation['reflect'] = reflectNode
    ? reflectValue?.kind === 'boolean'
      ? { state: 'explicit', value: reflectValue.value === 'true' }
      : { state: 'unknown', value: null }
    : { state: uncertain ? 'unknown' : 'absent', value: null };
  if (uncertain)
    return {
      converter: { state: 'unknown', expression: converterExpression },
      attribute: { state: 'unknown', name: null },
      reflect: { state: 'unknown', value: null },
      exposure,
    };
  return { converter, attribute, reflect, exposure };
}

function declaredName(node: WebComponentClass): string | null {
  const parent = node.getParent();
  return node.getName() ?? (parent && Node.isVariableDeclaration(parent) ? parent.getName() : null);
}

/** Preserve bounded syntax observations; framework metadata does not decide authorability. */
export function readWebComponentSyntax(classNode: WebComponentClass, componentSourcePath: string) {
  const observations: SourceCandidateObservation[] = [];
  const diagnostics: CompilerModuleDiagnostic[] = [];
  const props = new Map<string, RawPropDefinition>();
  const declaredProps = new Set<string>();
  const slots = new Map<string, RawSlotDefinition>();
  const visited = new Set<Node>();
  let declarationCount = 0;
  const report = (node: Node, reason: string) =>
    diagnostics.push({
      specifier: node.getText().slice(0, 256),
      fromPath: node.getSourceFile().getFilePath(),
      outcome: 'unavailable',
      reason,
    });
  const origin = (node: Node): SourceCandidateObservation['origin'] => {
    const source = node.getSourceFile();
    const program = source.getProject().getProgram().compilerObject;
    if (program.isSourceFileDefaultLibrary(source.compilerNode))
      return source.getBaseName().startsWith('lib.dom.') ? 'inherited-dom' : 'inherited-library';
    if (program.isSourceFileFromExternalLibrary(source.compilerNode)) return 'inherited-library';
    return resolve(source.getFilePath()) === resolve(componentSourcePath) ? 'own' : 'imported';
  };
  const add = (observation: SourceCandidateObservation, prop?: RawPropDefinition) => {
    if (declarationCount >= MAX_DECLARATIONS) {
      if (declarationCount === MAX_DECLARATIONS) report(classNode, 'wc-declaration-budget-exhausted');
      declarationCount += 1;
      return;
    }
    declarationCount += 1;
    observations.push(observation);
    if (
      prop &&
      (!props.has(prop.name) || (observation.evidenceKind === 'declaration' && !declaredProps.has(prop.name)))
    )
      props.set(prop.name, prop);
    if (observation.evidenceKind === 'declaration') declaredProps.add(observation.name);
  };
  const syntaxBase = (
    owner: WebComponentClass,
    lineage: WebComponentSyntaxObservation['lineage'],
  ): WebComponentSyntaxObservation => ({
    reader: 'web-component',
    lineage,
    declaringClass: declaredName(owner),
    converter: { state: 'absent', expression: null },
    attribute: { state: 'absent', name: null },
    reflect: { state: 'absent', value: null },
    exposure: [],
    default: resolveWcValue(undefined),
    typeLocations: [],
    slotKind: null,
  });
  const fallback = (
    name: string,
    type: string,
    node: Node,
    owner: WebComponentClass,
    lineage: WebComponentSyntaxObservation['lineage'],
    evidenceKind: SourceCandidateObservation['evidenceKind'],
    syntax?: Partial<WebComponentSyntaxObservation>,
  ) => {
    add(
      {
        name,
        keyPath: [name],
        evidenceKind,
        type,
        declaredRequired: null,
        sourceDefault: null,
        origin: origin(node),
        location: wcLocation(node),
        syntax: { ...syntaxBase(owner, lineage), ...syntax },
      },
      { name, type, required: false },
    );
  };
  const addSlot = (
    slot: RawSlotDefinition,
    node: Node,
    owner: WebComponentClass,
    lineage: WebComponentSyntaxObservation['lineage'],
    slotKind: 'jsdoc' | 'literal-template',
  ) => {
    if (!slots.has(slot.name)) slots.set(slot.name, slot);
    add({
      name: slot.name,
      keyPath: [slot.name],
      evidenceKind: 'implementation',
      type: 'slot',
      declaredRequired: null,
      sourceDefault: null,
      origin: origin(node),
      location: wcLocation(node),
      syntax: { ...syntaxBase(owner, lineage), slotKind },
    });
  };
  const processClass = (owner: WebComponentClass, lineage: WebComponentSyntaxObservation['lineage']) => {
    const staticOptions = new Map<string, Node>();
    let unknownStatic = false;
    const staticProperty = owner.getStaticMember('properties');
    let staticValue: Node | undefined;
    if (staticProperty && Node.isPropertyDeclaration(staticProperty)) staticValue = staticProperty.getInitializer();
    if (staticProperty && Node.isGetAccessorDeclaration(staticProperty)) {
      const statements = staticProperty.getBody()?.asKind(SyntaxKind.Block)?.getStatements();
      staticValue = statements?.find(Node.isReturnStatement)?.getExpression();
      unknownStatic = statements?.length !== 1 || !Node.isReturnStatement(statements[0]!);
    }
    const staticObject = optionsObject(staticValue);
    if (staticProperty && (unknownStatic || !staticObject)) {
      unknownStatic = true;
      report(staticProperty, 'wc-unknown-static-properties');
    }
    for (const member of staticObject?.getProperties() ?? []) {
      if (!Node.isPropertyAssignment(member)) {
        unknownStatic = true;
        report(member, 'wc-dynamic-static-properties');
        continue;
      }
      const name = wcKey(member.getNameNode());
      if (name !== null && member.getInitializer()) staticOptions.set(name, member.getInitializer()!);
      else report(member, 'wc-dynamic-property-key');
    }
    for (const member of owner.getMembers()) {
      if (
        (!Node.isPropertyDeclaration(member) &&
          !Node.isGetAccessorDeclaration(member) &&
          !Node.isSetAccessorDeclaration(member)) ||
        member.isStatic()
      )
        continue;
      const name = wcKey(member.getNameNode());
      if (name === null) {
        report(member, 'wc-dynamic-property-key');
        continue;
      }
      const decorators = member.getDecorators();
      const propertyDecorator = decorators.find((item) => ['property', 'state', 'attr'].includes(item.getName()));
      const decoratorOptions = propertyDecorator?.getArguments()[0];
      const metadata = metadataFor(
        name,
        propertyDecorator ? decoratorOptions : staticOptions.get(name),
        Boolean(propertyDecorator || staticOptions.has(name)),
        propertyDecorator ? false : unknownStatic,
        [
          ...(name.startsWith('_') ? ['underscore'] : []),
          ...(member.getScope() ? [member.getScope()!] : []),
          ...(name.startsWith('#') ? ['private'] : []),
          ...(decorators.some((item) => item.getName() === 'state') ? ['state'] : []),
          ...member
            .getJsDocs()
            .flatMap((doc) => doc.getTags())
            .filter((tag) => ['internal', 'private'].includes(tag.getTagName()))
            .map((tag) => tag.getTagName()),
          ...(origin(member) === 'inherited-library' ? ['library'] : []),
        ],
      );
      let typeNode;
      if (Node.isSetAccessorDeclaration(member)) typeNode = member.getParameters()[0]?.getTypeNode();
      else if (Node.isGetAccessorDeclaration(member)) typeNode = member.getReturnTypeNode();
      else typeNode = member.getTypeNode();
      const converterType: Record<string, string> = {
        String: 'string',
        Number: 'number',
        Boolean: 'boolean',
        Object: 'object',
        Array: 'unknown[]',
      };
      const initializer = Node.isPropertyDeclaration(member) ? member.getInitializer() : undefined;
      const defaultFact = resolveWcValue(initializer);
      const inferredType = defaultFact.value?.kind === 'null' ? 'unknown' : defaultFact.value?.kind;
      const type =
        typeNode?.getText() ??
        (metadata.converter.state === 'known' ? converterType[metadata.converter.expression!] : undefined) ??
        inferredType ??
        'unknown';
      const domain = resolveWcDomain(typeNode, type);
      const location = wcLocation(member);
      const declaredRequired = typeNode
        ? Node.isPropertyDeclaration(member)
          ? !member.hasQuestionToken()
          : true
        : null;
      const syntax = {
        ...syntaxBase(owner, lineage),
        ...metadata,
        default: defaultFact,
        typeLocations: domain.locations,
      };
      add(
        {
          name,
          keyPath: [name],
          evidenceKind: 'declaration',
          type,
          declaredRequired,
          sourceDefault: initializer?.getText() ?? null,
          origin: origin(member),
          location,
          syntax,
          fact: {
            origin: origin(member),
            resolvedKind: ['string', 'number', 'boolean'].includes(type)
              ? 'primitive'
              : (typeNode?.getKindName() ?? 'unknown'),
            certainty: domain.domain.openness === 'unknown' ? 'unknown' : 'certain',
            ambiguityReason: domain.domain.openness === 'unknown' ? 'unresolved-type-alternative' : null,
            declarations: [location],
            sourceTypeText: type,
            domain: domain.domain,
            declaredRequired,
            sourceDefault: initializer
              ? { expression: initializer.getText(), location: wcLocation(initializer) }
              : null,
            advisoryShape: null,
            shapeNotes: ['bounded-advisory-shape-not-derived'],
            requiredFieldDropped: null,
          },
        },
        {
          name,
          type,
          required: declaredRequired ?? false,
          ...(defaultFact.value ? { defaultValue: defaultFact.value.value } : {}),
          ...(domain.domain.openness === 'closed' && domain.domain.observedLiterals.length
            ? { allowedValues: domain.domain.observedLiterals.map((value) => value.value) }
            : {}),
          ...(resolve(member.getSourceFile().getFilePath()) === resolve(componentSourcePath)
            ? { sourceStartLine: member.getStartLineNumber(), sourceEndLine: member.getEndLineNumber() }
            : {}),
        },
      );
      staticOptions.delete(name);
    }
    for (const [name, options] of staticOptions) {
      const metadata = metadataFor(name, options, true, unknownStatic, []);
      const converterType: Record<string, string> = {
        String: 'string',
        Number: 'number',
        Boolean: 'boolean',
        Object: 'object',
        Array: 'unknown[]',
      };
      fallback(
        name,
        metadata.converter.state === 'known' ? (converterType[metadata.converter.expression!] ?? 'unknown') : 'unknown',
        options,
        owner,
        lineage,
        'runtime-object',
        metadata,
      );
    }
    const observed = owner.getStaticMember('observedAttributes');
    let observedValue: Node | undefined;
    let unknownObserved = false;
    if (observed && Node.isGetAccessorDeclaration(observed)) {
      const statements = observed.getBody()?.asKind(SyntaxKind.Block)?.getStatements();
      observedValue = statements?.find(Node.isReturnStatement)?.getExpression();
      unknownObserved = statements?.length !== 1 || !Node.isReturnStatement(statements[0]!);
    }
    if (observed && Node.isPropertyDeclaration(observed)) observedValue = observed.getInitializer();
    if (observed && unknownObserved) report(observed, 'wc-unknown-observed-attributes');
    if (observedValue && Node.isArrayLiteralExpression(observedValue))
      for (const item of observedValue.getElements()) {
        const name = resolveWcValue(item).value;
        if (name?.kind === 'string')
          fallback(name.value, 'string', item, owner, lineage, 'runtime-object', {
            attribute: unknownObserved ? { state: 'unknown', name: null } : { state: 'explicit', name: name.value },
          });
        else report(item, 'wc-dynamic-observed-attribute');
      }
    else if (observed) report(observed, 'wc-unknown-observed-attributes');
    for (const doc of owner.getJsDocs())
      for (const tag of doc.getTags()) {
        const text = tag.getCommentText()?.trim() ?? '';
        if (tag.getTagName() === 'slot') {
          const match = text.match(/^(\S+)\s*-\s*(.*)$/s);
          const name = match?.[1] ?? 'default';
          addSlot(
            { name, isDefault: name === 'default', description: match?.[2] ?? text.replace(/^-\s*/, '') },
            tag,
            owner,
            lineage,
            'jsdoc',
          );
        } else if (['attr', 'attribute'].includes(tag.getTagName())) {
          const match = text.match(/^(?:\{([^}]+)\}\s*)?(\S+)/);
          if (match) fallback(match[2]!, match[1] ?? 'string', tag, owner, lineage, 'implementation');
        }
      }
    const templateHelpers = new Set<Node>();
    const observeTemplate = (template: Node) => {
      if (Node.isNoSubstitutionTemplateLiteral(template) || Node.isStringLiteral(template)) {
        for (const slot of extractSlotsFromTemplate(template.getLiteralValue()))
          addSlot(slot, template, owner, lineage, 'literal-template');
      } else if (Node.isTemplateExpression(template)) {
        const literals = [
          template.getHead().getLiteralText(),
          ...template.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()),
        ];
        for (const literal of literals)
          for (const slot of extractSlotsFromTemplate(literal))
            addSlot(slot, template, owner, lineage, 'literal-template');
        report(template, 'wc-dynamic-template');
      }
    };
    const visitTemplates = (root: Node, depth = 0) => {
      if (depth >= MAX_CLASS_DEPTH || templateHelpers.size >= MAX_CLASS_DEPTH) {
        report(root, 'wc-template-helper-budget-exhausted');
        return;
      }
      if (templateHelpers.has(root)) return;
      templateHelpers.add(root);
      root.forEachDescendant((node, traversal) => {
        if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
          traversal.skip();
          return;
        }
        if (Node.isTaggedTemplateExpression(node) && node.getTag().getText() === 'html')
          observeTemplate(node.getTemplate());
        if (
          Node.isBinaryExpression(node) &&
          node.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
          node.getLeft().getText().endsWith('.innerHTML')
        )
          observeTemplate(node.getRight());
        if (!Node.isCallExpression(node)) return;
        const expression = node.getExpression();
        const declarations = wcDeclarations(expression);
        for (const declaration of declarations) {
          const helper = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
          if (
            helper &&
            (Node.isFunctionDeclaration(helper) ||
              Node.isFunctionExpression(helper) ||
              Node.isArrowFunction(helper) ||
              Node.isMethodDeclaration(helper))
          ) {
            const body = helper.getBody();
            if (body) visitTemplates(body, depth + 1);
          }
        }
      });
    };
    for (const member of owner.getMembers()) visitTemplates(member);
  };
  const walk = (
    node: Node,
    environment: ReadonlyMap<string, Node>,
    lineage: WebComponentSyntaxObservation['lineage'],
    depth: number,
  ) => {
    if (depth >= MAX_CLASS_DEPTH) {
      report(node, 'wc-inheritance-depth-exhausted');
      return;
    }
    if (visited.has(node)) {
      report(node, 'wc-inheritance-cycle');
      return;
    }
    if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node)) {
      walk(node.getExpression(), environment, lineage, depth + 1);
      return;
    }
    if (Node.isIdentifier(node)) {
      const supplied = environment.get(node.getText());
      if (supplied) {
        walk(supplied, new Map(), 'base', depth + 1);
        return;
      }
      const declarations = wcDeclarations(node);
      if (!declarations.length) {
        report(node, 'wc-unresolved-base');
        return;
      }
      for (const declaration of declarations) walk(declaration, environment, lineage, depth + 1);
      return;
    }
    if (Node.isVariableDeclaration(node)) {
      visited.add(node);
      const initializer = node.getInitializer();
      if (initializer) walk(initializer, environment, lineage, depth + 1);
      else report(node, 'wc-unresolved-base');
      return;
    }
    if (Node.isCallExpression(node)) {
      visited.add(node);
      const expression = node.getExpression();
      if (!Node.isIdentifier(expression)) {
        report(node, 'wc-unresolved-mixin');
        return;
      }
      const declarations = wcDeclarations(expression);
      let resolved = false;
      for (const declaration of declarations) {
        const fn = Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : declaration;
        if (!fn || (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn) && !Node.isFunctionDeclaration(fn)))
          continue;
        const nextEnvironment = new Map(environment);
        fn.getParameters().forEach((parameter, index) => {
          const argument = node.getArguments()[index];
          if (argument) nextEnvironment.set(parameter.getName(), argument);
        });
        const body = fn.getBody();
        const result =
          body && Node.isBlock(body) ? body.getStatements().find(Node.isReturnStatement)?.getExpression() : body;
        if (result && (Node.isClassExpression(result) || Node.isParenthesizedExpression(result))) {
          walk(result, nextEnvironment, 'mixin', depth + 1);
          resolved = true;
        }
      }
      if (!resolved) report(node, 'wc-unresolved-mixin');
      return;
    }
    if (Node.isClassDeclaration(node) || Node.isClassExpression(node)) {
      visited.add(node);
      const source = node.getSourceFile();
      if (source.isDeclarationFile() && origin(node) === 'inherited-dom') return;
      processClass(node, lineage);
      const base = node.getExtends()?.getExpression();
      if (base) walk(base, environment, 'base', depth + 1);
      return;
    }
    if (Node.isInterfaceDeclaration(node) && origin(node) === 'inherited-dom') return;
    report(node, 'wc-unresolved-base');
  };
  walk(classNode, new Map(), 'own', 0);
  const projectedProps = [...props.values()].sort((a, b) => a.name.localeCompare(b.name));
  const projectedSlots = [...slots.values()].sort((a, b) => a.name.localeCompare(b.name));
  const candidates = mergeSourceCandidates(observations, projectedProps, projectedSlots);
  if (candidates.omittedCount) report(classNode, 'wc-candidate-budget-exhausted');
  return {
    props: projectedProps,
    slots: projectedSlots,
    sourceCandidates: candidates.candidates,
    diagnostics,
    limits: { maxWcClassDepth: MAX_CLASS_DEPTH, maxWcDeclarations: MAX_DECLARATIONS },
    used: { wcDeclarations: declarationCount },
  };
}
