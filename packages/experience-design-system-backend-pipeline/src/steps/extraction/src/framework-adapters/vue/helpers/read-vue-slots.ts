import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import ts from 'typescript';
import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';
import type { SourceCandidateObservation, SourceFactLocation } from '../../../candidates/types.js';
import { isVueMacroCall, vueDiagnostic, vueLocation, vueSyntax, type VueReaderContext } from './read-vue-runtime.js';

interface TemplateNode {
  type: number;
  tag?: string;
  name?: string;
  content?: string | { content: string };
  value?: { content: string };
  arg?: { content: string; isStatic?: boolean };
  exp?: { content: string };
  props?: TemplateNode[];
  children?: TemplateNode[];
  loc?: { start: { line: number; offset: number }; end: { line: number; offset: number }; source: string };
}

export interface VueSlotsResult {
  slots: RawSlotDefinition[];
  observations: SourceCandidateObservation[];
}

/** Keep contract, occurrence and access evidence independent of the projected slot list. */
export function readVueSlots(
  sourceFile: SourceFile | undefined,
  context: VueReaderContext,
  template?: unknown,
  contract?: Node,
  componentOptions?: import('ts-morph').ObjectLiteralExpression,
): VueSlotsResult {
  const slots = new Map<string, RawSlotDefinition>();
  const observations: SourceCandidateObservation[] = [];
  const scope = componentOptions ?? sourceFile;
  const add = (
    name: string | undefined,
    channel: 'slot-contract' | 'slot-template' | 'slot-access',
    expression: string,
    location: SourceFactLocation,
    extra: Partial<ReturnType<typeof vueSyntax>> = {},
    type = 'unknown',
    required: boolean | null = null,
  ) => {
    const dynamic = name === undefined;
    const candidateName = name ?? `@slot:${expression}`;
    const syntax = {
      ...vueSyntax(context, channel, expression),
      ...extra,
      ...(dynamic ? { resolution: 'unresolved' as const, resolutionReason: 'dynamic-name' } : {}),
    };
    observations.push({
      name: candidateName,
      keyPath: [candidateName],
      evidenceKind: 'implementation',
      type,
      declaredRequired: required,
      sourceDefault: null,
      origin: location.canonicalPath === resolve(context.sourcePath) ? 'own' : 'imported',
      location,
      syntax,
    });
    if (name !== undefined) slots.set(name, { name, isDefault: name === 'default' });
    else vueDiagnostic(context, 'vue-slots-dynamic-name');
  };

  function readContract(node: Node): void {
    try {
      const type = node.getType();
      if (type.isAny() || type.isUnknown() || type.isNever()) {
        vueDiagnostic(context, 'vue-slots-unresolved', node);
        return;
      }
      const properties = type.getProperties();
      let partial = type.isUnion() || Boolean(type.getStringIndexType() || type.getNumberIndexType());
      for (const property of properties) {
        const declaration = property.getDeclarations()[0];
        if (!declaration) {
          vueDiagnostic(context, 'vue-slots-partial', node);
          continue;
        }
        let propertyType = 'unknown';
        let propertyFailure = false;
        try {
          propertyType = property.getTypeAtLocation(declaration).getText(declaration);
        } catch {
          propertyFailure = true;
          partial = true;
          vueDiagnostic(context, 'vue-slots-declaration-throw', declaration);
        }
        add(
          property.getName(),
          'slot-contract',
          declaration.getText(),
          vueLocation(declaration, context),
          {
            resolution: partial ? 'partial' : 'resolved',
            resolutionReason: propertyFailure ? 'vue-slots-declaration-throw' : null,
            typeLocations: [vueLocation(declaration, context)],
          },
          propertyType,
          !property.isOptional(),
        );
      }
      const empty = properties.length === 0 && !partial && (type.getText(node) === '{}' || Node.isTypeLiteral(node));
      vueDiagnostic(
        context,
        `vue-slots-${partial ? 'partial' : properties.length ? 'resolved' : empty ? 'empty' : 'unresolved'}`,
        node,
        !partial && (properties.length > 0 || empty),
      );
    } catch {
      vueDiagnostic(context, 'vue-slots-throw', node);
    }
  }

  const contracts: Node[] = contract ? [contract] : [];
  if (sourceFile) {
    for (const call of scope!.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (
        call.getExpression().getText() !== 'defineSlots' ||
        call.getFirstAncestor(
          (node) => Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node),
        )
      )
        continue;
      if (!isVueMacroCall(call, context)) continue;
      const typeNode = call.getTypeArguments()[0];
      if (typeNode) contracts.push(typeNode);
      else vueDiagnostic(context, 'vue-slots-unresolved', call);
    }
  }
  for (const node of contracts) readContract(node);
  if (!contracts.length) vueDiagnostic(context, 'vue-slots-absent', undefined, true);

  if (sourceFile) {
    const slotBindings = new Set<Node>();
    const contextBindings = new Set<Node>();
    for (const variable of scope!.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = variable.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) continue;
      const expression = initializer.getExpression();
      if (
        Node.isIdentifier(expression) &&
        expression.getText() === 'defineSlots' &&
        isVueMacroCall(initializer, context)
      )
        slotBindings.add(variable);
      const imported = Node.isIdentifier(expression)
        ? (expression.getSymbol()?.getDeclarations() ?? []).some(
            (declaration) =>
              Node.isImportSpecifier(declaration) &&
              declaration.getName() === 'useSlots' &&
              declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === 'vue',
          )
        : Node.isPropertyAccessExpression(expression) &&
          expression.getName() === 'useSlots' &&
          (expression.getExpression().getSymbol()?.getDeclarations() ?? []).some(
            (declaration) =>
              Node.isNamespaceImport(declaration) &&
              declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() === 'vue',
          );
      if (imported) slotBindings.add(variable);
      else if (expression.getText() === 'useSlots') vueDiagnostic(context, 'vue-slots-binding-unresolved', variable);
    }
    const options = componentOptions
      ? [componentOptions]
      : sourceFile.getExportAssignments().flatMap((assignment) => {
          const expression = assignment.getExpression();
          if (Node.isObjectLiteralExpression(expression)) return [expression];
          if (Node.isCallExpression(expression) && Node.isObjectLiteralExpression(expression.getArguments()[0]))
            return [expression.getArguments()[0] as import('ts-morph').ObjectLiteralExpression];
          return [];
        });
    for (const option of options) {
      const setup = option.getProperty('setup');
      const fn = setup && Node.isPropertyAssignment(setup) ? setup.getInitializer() : setup;
      if (!fn || (!Node.isMethodDeclaration(fn) && !Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)))
        continue;
      const parameter = fn.getParameters()[1];
      if (!parameter) continue;
      const name = parameter.getNameNode();
      if (Node.isIdentifier(name)) contextBindings.add(parameter);
      if (Node.isObjectBindingPattern(name)) {
        for (const binding of name.getElements()) {
          if ((binding.getPropertyNameNode()?.getText() ?? binding.getName()) === 'slots') slotBindings.add(binding);
        }
      }
    }
    const bound = (node: Node, bindings: Set<Node>) =>
      Node.isIdentifier(node) &&
      (node.getSymbol()?.getDeclarations() ?? []).some((declaration) => bindings.has(declaration));
    const memberName = (node: Node): string | undefined => {
      if (Node.isPropertyAccessExpression(node)) return node.getName();
      if (Node.isElementAccessExpression(node)) {
        const key = node.getArgumentExpression();
        if (key && (Node.isStringLiteral(key) || Node.isNoSubstitutionTemplateLiteral(key)))
          return key.getLiteralValue();
      }
      return undefined;
    };
    const aliasInitializer = (node: Node): Node | undefined => {
      if (!Node.isIdentifier(node)) return undefined;
      const declarations = node.getSymbol()?.getDeclarations() ?? [];
      if (declarations.length !== 1) return undefined;
      const declaration = declarations[0]!;
      if (
        !Node.isVariableDeclaration(declaration) ||
        declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclarationList)?.getDeclarationKind() !== 'const'
      )
        return undefined;
      return declaration.getInitializer();
    };
    const contextObject = (node: Node, active = new Set<Node>()): boolean => {
      if (bound(node, contextBindings)) return true;
      if (active.has(node) || active.size >= 64) return false;
      active.add(node);
      const initializer = aliasInitializer(node);
      return Boolean(initializer && contextObject(initializer, active));
    };
    const slotObject = (node: Node, active = new Set<Node>()): boolean => {
      if (bound(node, slotBindings)) return true;
      if (active.has(node) || active.size >= 64) return false;
      active.add(node);
      if (Node.isPropertyAccessExpression(node) || Node.isElementAccessExpression(node)) {
        if (memberName(node) === 'slots' && contextObject(node.getExpression())) return true;
        if (memberName(node) === '$slots' && node.getExpression().getKind() === SyntaxKind.ThisKeyword) return true;
      }
      const initializer = aliasInitializer(node);
      return Boolean(initializer && slotObject(initializer, active));
    };
    for (const variable of scope!.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const name = variable.getNameNode();
      const initializer = variable.getInitializer();
      if (!Node.isObjectBindingPattern(name) || !initializer || !slotObject(initializer)) continue;
      for (const binding of name.getElements()) {
        if (binding.getDotDotDotToken()) continue;
        const key = binding.getPropertyNameNode() ?? binding.getNameNode();
        const name = Node.isIdentifier(key)
          ? key.getText()
          : Node.isStringLiteral(key)
            ? key.getLiteralValue()
            : undefined;
        add(name, 'slot-access', binding.getText(), vueLocation(binding, context));
      }
    }
    for (const access of scope!.getDescendants()) {
      if (!Node.isPropertyAccessExpression(access) && !Node.isElementAccessExpression(access)) continue;
      if (!slotObject(access.getExpression())) continue;
      const argument = Node.isElementAccessExpression(access) ? access.getArgumentExpression() : undefined;
      const name = Node.isPropertyAccessExpression(access)
        ? access.getName()
        : argument && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
          ? argument.getLiteralValue()
          : undefined;
      add(name, 'slot-access', access.getText(), vueLocation(access, context));
    }
  }

  const templateLocation = (node: TemplateNode): SourceFactLocation => ({
    fileId: null,
    canonicalPath: resolve(context.sourcePath),
    textHash: createHash('sha256').update(context.source).digest('hex'),
    startLine: node.loc?.start.line ?? null,
    endLine: node.loc?.end.line ?? null,
    startOffset: node.loc?.start.offset ?? null,
    endOffset: node.loc?.end.offset ?? null,
    binding: 'unverified',
  });
  function templateAccess(expression: string, node: TemplateNode, conditions: string[], loops: string[]): void {
    const parsed = ts.createSourceFile('__vue_expression__.ts', expression, ts.ScriptTarget.Latest, true);
    const walk = (current: ts.Node) => {
      if (
        (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
        ts.isIdentifier(current.expression) &&
        current.expression.text === '$slots'
      ) {
        const name = ts.isPropertyAccessExpression(current)
          ? current.name.text
          : current.argumentExpression && ts.isStringLiteralLike(current.argumentExpression)
            ? current.argumentExpression.text
            : undefined;
        add(name, 'slot-access', current.getText(parsed), templateLocation(node), { conditions, loops });
      }
      ts.forEachChild(current, walk);
    };
    walk(parsed);
  }
  function walk(node: TemplateNode, conditions: string[], loops: string[]): void {
    const ownConditions = [...conditions];
    const ownLoops = [...loops];
    for (const directive of node.props ?? []) {
      if (directive.type !== 7) continue;
      if (['if', 'else-if', 'else'].includes(directive.name ?? ''))
        ownConditions.push(`${directive.name}:${directive.exp?.content ?? ''}`);
      if (directive.name === 'for') ownLoops.push(directive.exp?.content ?? '');
      if (directive.exp) templateAccess(directive.exp.content, directive, ownConditions, ownLoops);
    }
    if (node.type === 1 && node.tag === 'slot') {
      const staticName = node.props?.find((prop) => prop.type === 6 && prop.name === 'name');
      const boundName = node.props?.find(
        (prop) => prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'name',
      );
      let name: string | undefined = staticName?.value?.content ?? 'default';
      if (boundName) {
        const text = boundName.exp?.content ?? '';
        const parsed = ts.createSourceFile('__slot_name__.ts', text, ts.ScriptTarget.Latest, true);
        const expression = parsed.statements[0];
        name =
          expression && ts.isExpressionStatement(expression) && ts.isStringLiteralLike(expression.expression)
            ? expression.expression.text
            : undefined;
      }
      add(name, 'slot-template', node.loc?.source ?? '<slot>', templateLocation(node), {
        conditions: ownConditions,
        loops: ownLoops,
        fallback: node.children?.length ? node.children.map((child) => child.loc?.source ?? '').join('') : null,
      });
    }
    if (node.type === 5 && node.content)
      templateAccess(
        typeof node.content === 'string' ? node.content : (node.content as { content: string }).content,
        node,
        ownConditions,
        ownLoops,
      );
    for (const child of node.children ?? []) walk(child, ownConditions, ownLoops);
  }
  if (template && typeof template === 'object') walk(template as TemplateNode, [], []);
  return { slots: [...slots.values()].sort((a, b) => a.name.localeCompare(b.name)), observations };
}
