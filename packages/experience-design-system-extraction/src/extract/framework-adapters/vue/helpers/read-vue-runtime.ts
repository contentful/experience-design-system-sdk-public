import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import type {
  ExtractionDiagnostics,
  SourceCandidateObservation,
  SourceDomainLiteral,
  SourceFactLocation,
  VueSyntaxObservation,
} from '../../../candidates/types.js';
import { observeRawProps } from '../../../candidates/source-candidates.js';
import { getValueTargetDeclarations } from '../../shared/helpers/tsx-shared.js';

export interface VueReaderContext {
  sourcePath: string;
  source: string;
  diagnostics: ExtractionDiagnostics;
  occurrence: number;
}

export function vueLocation(node: Node, context: VueReaderContext): SourceFactLocation {
  const file = node.getSourceFile();
  const virtual = file.getFilePath().endsWith('.vue.source-evidence.ts');
  return {
    fileId: null,
    canonicalPath: virtual ? file.getFilePath().replace(/\.source-evidence\.ts$/, '') : resolve(file.getFilePath()),
    textHash: createHash('sha256')
      .update(
        virtual && resolve(context.sourcePath) === resolve(file.getFilePath().replace(/\.source-evidence\.ts$/, ''))
          ? context.source
          : file.getFullText(),
      )
      .digest('hex'),
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber(),
    startOffset: node.getStart(),
    endOffset: node.getEnd(),
    binding: 'unverified',
  };
}

export function vueDiagnostic(context: VueReaderContext, reason: string, node?: Node, resolved = false): void {
  context.diagnostics.modules.push({
    specifier: node ? `${node.getKindName()}@${node.getStartLineNumber()}:${node.getStart()}` : 'vue-source',
    fromPath: node ? vueLocation(node, context).canonicalPath! : resolve(context.sourcePath),
    outcome: resolved ? 'resolved' : 'unavailable',
    reason,
  });
  if (!resolved) context.diagnostics.coverage = 'partial';
}

export function vuePropertyName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return String(node.getLiteralValue());
  if (Node.isComputedPropertyName(node)) return vuePropertyName(node.getExpression());
  return undefined;
}

export function isVueMacroCall(call: import('ts-morph').CallExpression, context?: VueReaderContext): boolean {
  const expression = call.getExpression();
  if (!Node.isIdentifier(expression)) return false;
  const declarations = expression.getSymbol()?.getDeclarations() ?? [];
  const shadowed = declarations.some(
    (declaration) =>
      !Node.isImportSpecifier(declaration) ||
      declaration.getFirstAncestorByKind(SyntaxKind.ImportDeclaration)?.getModuleSpecifierValue() !== 'vue',
  );
  if (shadowed && context) vueDiagnostic(context, 'vue-macro-binding-unresolved', call);
  return !shadowed;
}

function literal(node: Node): SourceDomainLiteral | null {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))
    return { kind: 'string', value: node.getLiteralValue() };
  if (Node.isNumericLiteral(node)) return { kind: 'number', value: node.getText() };
  if (node.getKind() === SyntaxKind.TrueKeyword || node.getKind() === SyntaxKind.FalseKeyword)
    return { kind: 'boolean', value: node.getText() };
  if (Node.isNullLiteral(node)) return { kind: 'null', value: 'null' };
  if (Node.isPrefixUnaryExpression(node) && /^-\d/.test(node.getText()))
    return { kind: 'number', value: node.getText() };
  return null;
}

export function vueSyntax(
  context: VueReaderContext,
  channel: VueSyntaxObservation['channel'],
  expression: string,
  defaultNode?: Node,
): VueSyntaxObservation {
  const value = defaultNode ? literal(defaultNode) : null;
  return {
    reader: 'vue',
    channel,
    occurrence: context.occurrence++,
    resolution: 'resolved',
    resolutionReason: null,
    expression,
    spreadPath: [],
    conditions: [],
    loops: [],
    fallback: null,
    default: {
      expression: defaultNode?.getText() ?? null,
      state: defaultNode ? (value ? 'literal' : 'unresolved') : 'absent',
      value,
      reason: defaultNode && !value ? 'expression-not-evaluated' : null,
      locations: defaultNode ? [vueLocation(defaultNode, context)] : [],
    },
    typeLocations: [],
  };
}

const constructors: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Object: 'object',
  Array: 'any[]',
  Function: 'function',
};
function runtimeType(node: Node | undefined): string {
  if (!node) return 'unknown';
  if (Node.isParenthesizedExpression(node)) return runtimeType(node.getExpression());
  if (Node.isAsExpression(node) || Node.isTypeAssertion(node)) {
    const type = node.getTypeNode();
    if (Node.isTypeReference(type) && /(^|\.)PropType$/.test(type.getTypeName().getText())) {
      const argument = type.getTypeArguments()[0];
      return argument?.getType().getText(argument) ?? 'unknown';
    }
    return runtimeType(node.getExpression());
  }
  if (Node.isArrayLiteralExpression(node))
    return [...new Set(node.getElements().map(runtimeType))].join(' | ') || 'unknown';
  if (Node.isIdentifier(node)) return constructors[node.getText()] ?? 'unknown';
  return 'unknown';
}

export interface VueRuntimeResult {
  props: RawPropDefinition[];
  observations: SourceCandidateObservation[];
  resolution: 'resolved' | 'partial' | 'unresolved';
}

/** Read object occurrences in JavaScript order; active recursion is separate from repeated uses. */
export function readVueRuntimeProps(root: Node, context: VueReaderContext): VueRuntimeResult {
  const observations: SourceCandidateObservation[] = [];
  const props = new Map<string, RawPropDefinition>();
  const active = new Set<Node>();
  const maxOccurrences = 4096;
  context.diagnostics.limits.maxVueRuntimeDepth = 64;
  context.diagnostics.limits.maxVueRuntimeOccurrences = maxOccurrences;
  let visits = 0;
  const diagnosticStart = context.diagnostics.modules.length;

  function unavailable(node: Node, reason: string, spreadPath: string[]): void {
    vueDiagnostic(context, reason, node);
    const syntax = vueSyntax(context, 'prop', node.getText());
    syntax.resolution = 'unresolved';
    syntax.resolutionReason = reason;
    syntax.spreadPath = spreadPath;
    const name = `@source:${node.getText()}`;
    observations.push({
      name,
      keyPath: [name],
      evidenceKind: 'implementation',
      type: 'unknown',
      declaredRequired: null,
      sourceDefault: null,
      origin: 'unknown',
      location: vueLocation(node, context),
      syntax,
    });
  }

  function add(property: Node, name: string, initializer: Node | undefined, spreadPath: string[]): void {
    let typeNode = initializer;
    let requiredNode: Node | undefined;
    let defaultNode: Node | undefined;
    let unknownOptions = false;
    if (initializer && Node.isObjectLiteralExpression(initializer)) {
      const fields = initializer.getProperties();
      unknownOptions = fields.some((member) => {
        if (!Node.isPropertyAssignment(member)) return true;
        const name = member.getNameNode();
        return (
          (Node.isComputedPropertyName(name) && Node.isIdentifier(name.getExpression())) ||
          vuePropertyName(name) === undefined
        );
      });
      const read = (key: string) => {
        const member = [...fields]
          .reverse()
          .find((item) => Node.isPropertyAssignment(item) && vuePropertyName(item.getNameNode()) === key);
        return member && Node.isPropertyAssignment(member) ? member.getInitializer() : undefined;
      };
      typeNode = unknownOptions ? undefined : read('type');
      requiredNode = read('required');
      defaultNode = read('default');
    }
    const type = runtimeType(typeNode);
    const required = !unknownOptions && requiredNode?.getText() === 'true';
    const definition = {
      name,
      type,
      required,
      ...(!unknownOptions && defaultNode ? { defaultValue: defaultNode.getText() } : {}),
    };
    props.set(name, definition);
    const location = vueLocation(property, context);
    const syntax = vueSyntax(context, 'prop', property.getText(), defaultNode);
    syntax.spreadPath = spreadPath;
    syntax.typeLocations = typeNode ? [vueLocation(typeNode, context)] : [];
    if (unknownOptions || type === 'unknown' || (requiredNode && !['true', 'false'].includes(requiredNode.getText())))
      syntax.resolution = 'partial';
    if (unknownOptions) {
      syntax.resolutionReason = 'vue-runtime-options-unresolved';
      syntax.default = {
        ...syntax.default,
        state: 'unresolved',
        value: null,
        reason: 'vue-runtime-options-unresolved',
      };
    }
    const observation = observeRawProps([definition], 'declaration', {
      origin: location.canonicalPath === resolve(context.sourcePath) ? 'own' : 'imported',
      locations: new Map([[name, location]]),
    })[0]!;
    observation.declaredRequired = unknownOptions
      ? null
      : requiredNode
        ? ['true', 'false'].includes(requiredNode.getText())
          ? required
          : null
        : false;
    observations.push({ ...observation, syntax });
    if (syntax.resolution === 'partial')
      vueDiagnostic(
        context,
        unknownOptions ? 'vue-runtime-options-unresolved' : 'vue-runtime-declaration-partial',
        property,
      );
  }

  function visit(node: Node, spreadPath: string[], depth: number): void {
    if (context.diagnostics.used.vueRuntimeOccurrences === undefined)
      context.diagnostics.used.vueRuntimeOccurrences = 0;
    if (visits++ >= maxOccurrences || depth >= 64) {
      unavailable(node, 'vue-runtime-budget-exhausted', spreadPath);
      return;
    }
    if (active.has(node)) {
      unavailable(node, 'vue-runtime-cycle', spreadPath);
      return;
    }
    active.add(node);
    try {
      if (
        Node.isParenthesizedExpression(node) ||
        Node.isAsExpression(node) ||
        Node.isTypeAssertion(node) ||
        Node.isSatisfiesExpression(node)
      ) {
        visit(node.getExpression(), spreadPath, depth + 1);
        return;
      }
      if (Node.isObjectLiteralExpression(node)) {
        for (const property of node.getProperties()) {
          if (Node.isSpreadAssignment(property))
            visit(property.getExpression(), [...spreadPath, property.getText()], depth + 1);
          else if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) {
            const nameNode = property.getNameNode();
            const name =
              Node.isComputedPropertyName(nameNode) && Node.isIdentifier(nameNode.getExpression())
                ? undefined
                : vuePropertyName(nameNode);
            if (name === undefined) {
              unavailable(property, 'vue-runtime-dynamic-key', spreadPath);
              continue;
            }
            add(
              property,
              name,
              Node.isPropertyAssignment(property) ? property.getInitializer() : property.getNameNode(),
              spreadPath,
            );
          } else unavailable(property, 'vue-runtime-member-unresolved', spreadPath);
        }
        return;
      }
      if (Node.isArrayLiteralExpression(node)) {
        for (const element of node.getElements()) {
          if (Node.isStringLiteral(element)) add(element, element.getLiteralValue(), undefined, spreadPath);
          else unavailable(element, 'vue-runtime-array-member-unresolved', spreadPath);
        }
        return;
      }
      if (Node.isIdentifier(node)) {
        const declarations = getValueTargetDeclarations(node);
        let resolved = false;
        for (const declaration of declarations) {
          if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            if (initializer) {
              resolved = true;
              visit(initializer, spreadPath, depth + 1);
            }
          }
        }
        if (!resolved) unavailable(node, 'vue-runtime-reference-unresolved', spreadPath);
        return;
      }
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        const declarations = Node.isIdentifier(expression) ? getValueTargetDeclarations(expression) : [];
        for (const declaration of declarations) {
          let fn: Node | undefined = declaration;
          if (Node.isVariableDeclaration(declaration)) fn = declaration.getInitializer();
          if (!fn || (!Node.isFunctionDeclaration(fn) && !Node.isFunctionExpression(fn) && !Node.isArrowFunction(fn)))
            continue;
          if (fn.getParameters().length || node.getArguments().length) continue;
          const body = fn.getBody();
          if (!body) continue;
          if (Node.isBlock(body)) {
            const statements = body.getStatements();
            const returns = statements.filter(Node.isReturnStatement);
            if (
              returns.length !== 1 ||
              statements.some((statement) => !Node.isReturnStatement(statement) && !Node.isVariableStatement(statement))
            )
              continue;
            const returned = returns[0]!.getExpression();
            if (returned) {
              visit(returned, [...spreadPath, node.getText()], depth + 1);
              return;
            }
          } else {
            visit(body, [...spreadPath, node.getText()], depth + 1);
            return;
          }
        }
        unavailable(node, 'vue-runtime-call-unresolved', spreadPath);
        return;
      }
      unavailable(node, 'vue-runtime-expression-unresolved', spreadPath);
    } finally {
      active.delete(node);
    }
  }
  visit(root, [], 0);
  context.diagnostics.used.vueRuntimeOccurrences = (context.diagnostics.used.vueRuntimeOccurrences ?? 0) + visits;
  const partial = context.diagnostics.modules.slice(diagnosticStart).some((item) => item.outcome === 'unavailable');
  return {
    props: [...props.values()],
    observations,
    resolution: partial ? (props.size ? 'partial' : 'unresolved') : 'resolved',
  };
}

/** Only the exported owner and top-level macro options declare an SFC component. */
export function vueComponentOptions(
  sourceFile: SourceFile,
  context?: VueReaderContext,
): import('ts-morph').ObjectLiteralExpression[] {
  const result: import('ts-morph').ObjectLiteralExpression[] = [];
  const add = (node: Node | undefined) => {
    if (node && Node.isObjectLiteralExpression(node)) result.push(node);
    else if (node && Node.isCallExpression(node) && /(^|\.)defineComponent$/.test(node.getExpression().getText()))
      add(node.getArguments()[0]);
  };
  for (const assignment of sourceFile.getExportAssignments()) add(assignment.getExpression());
  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const call = statement.getExpression();
    if (
      Node.isCallExpression(call) &&
      call.getExpression().getText() === 'defineOptions' &&
      isVueMacroCall(call, context)
    )
      add(call.getArguments()[0]);
  }
  return result;
}
