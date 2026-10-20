import ts from 'typescript';

/** Writes resolve the value binding, including shorthand assignment targets. */
export class SourceValueBindings {
  private readonly writes = new Set<ts.Declaration>();
  private readonly scanned = new Map<ts.SourceFile, boolean>();
  scanNodes = 0;
  constructor(private readonly checker: ts.TypeChecker) {}
  declaration(node: ts.Node): ts.Declaration | undefined {
    let symbol = ts.isShorthandPropertyAssignment(node)
      ? this.checker.getShorthandAssignmentValueSymbol(node)
      : this.checker.getSymbolAtLocation(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias) symbol = this.checker.getAliasedSymbol(symbol);
    return symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  }
  private target(node: ts.Node, seen = new Set<ts.Node>()): void {
    if (seen.has(node) || seen.size > 64) return;
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      this.target(node.expression, seen);
    else if (ts.isIdentifier(node) || ts.isShorthandPropertyAssignment(node)) {
      const declaration = this.declaration(node);
      if (declaration) {
        this.writes.add(declaration);
        if (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          (ts.isIdentifier(declaration.initializer) ||
            ts.isPropertyAccessExpression(declaration.initializer) ||
            ts.isElementAccessExpression(declaration.initializer))
        )
          this.target(declaration.initializer, seen);
      }
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      this.target(node.expression, seen);
    else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) this.target(property.initializer, new Set(seen));
        else if (ts.isShorthandPropertyAssignment(property)) this.target(property, new Set(seen));
        else if (ts.isSpreadAssignment(property)) this.target(property.expression, new Set(seen));
      }
    } else if (ts.isArrayLiteralExpression(node))
      node.elements.forEach((element) => this.target(element, new Set(seen)));
    else if (ts.isSpreadElement(node)) this.target(node.expression, seen);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
      this.target(node.left, seen);
  }
  scan(file: ts.SourceFile, maxNodes: number): boolean {
    const cached = this.scanned.get(file);
    if (cached !== undefined) return cached;
    let visited = 0;
    let complete = true;
    const visit = (node: ts.Node): void => {
      if (visited >= maxNodes) {
        complete = false;
        return;
      }
      visited += 1;
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        this.target(node.left);
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
      )
        this.target(node.operand);
      if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer))
        this.target(node.initializer);
      ts.forEachChild(node, (child) => {
        visit(child);
        return complete ? undefined : true;
      });
    };
    visit(file);
    this.scanNodes += visited;
    this.scanned.set(file, complete);
    return complete;
  }
  mutated(declaration: ts.Declaration): boolean {
    return this.writes.has(declaration);
  }
  constant(node: ts.Node, seen = new Set<ts.Node>()): string | null {
    if (seen.has(node) || seen.size > 64) return null;
    seen.add(node);
    if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return this.constant(node.expression, seen);
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return String(-Number(node.operand.text));
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = this.constant(span.expression, new Set(seen));
        if (part === null) return null;
        value += part + span.literal.text;
      }
      return value;
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const declaration = this.declaration(ts.isPropertyAccessExpression(node) ? node.name : node);
      if (
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        declaration.parent.flags & ts.NodeFlags.Const &&
        !this.mutated(declaration)
      )
        return this.constant(declaration.initializer, seen);
    }
    return null;
  }
  key(node: ts.PropertyName | ts.Expression): string | null {
    if (ts.isComputedPropertyName(node)) return this.constant(node.expression);
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
    return null;
  }
}
