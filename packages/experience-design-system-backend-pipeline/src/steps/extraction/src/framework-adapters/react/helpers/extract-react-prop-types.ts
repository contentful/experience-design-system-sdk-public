import { Node, type SourceFile } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';

const PROP_TYPES_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  func: 'function',
  node: 'ReactNode',
  element: 'ReactElement',
  any: 'any',
  array: 'any[]',
  object: 'object',
  symbol: 'symbol',
};

export function extractPropTypes(sourceFile: SourceFile, componentName: string): RawPropDefinition[] | undefined {
  const props: RawPropDefinition[] = [];

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expr = statement.getExpression();
    if (!Node.isBinaryExpression(expr)) continue;

    const left = expr.getLeft().getText();
    if (left !== `${componentName}.propTypes`) continue;

    const right = expr.getRight();
    if (!Node.isObjectLiteralExpression(right)) continue;

    for (const property of right.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;

      const propName = property.getName();
      const initText = property.getInitializer()?.getText() ?? '';

      let type = 'any';
      let required = false;
      let allowedValues: string[] | undefined;

      if (initText.includes('.isRequired')) required = true;

      const oneOfMatch = initText.match(/PropTypes\.oneOf\(\[([^\]]+)\]\)/);
      if (oneOfMatch) {
        allowedValues = oneOfMatch[1]
          .split(',')
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
          .sort();
      }

      for (const [ptKey, tsType] of Object.entries(PROP_TYPES_MAP)) {
        if (initText.includes(`PropTypes.${ptKey}`)) {
          type = tsType;
          break;
        }
      }

      props.push({
        name: propName,
        type,
        required,
        ...(allowedValues && { allowedValues }),
        sourceStartLine: property.getStartLineNumber(),
        sourceEndLine: property.getEndLineNumber(),
      });
    }

    return props.sort((a, b) => a.name.localeCompare(b.name));
  }

  return undefined;
}
