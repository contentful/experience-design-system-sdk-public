import { Node, type ObjectLiteralExpression } from 'ts-morph';

/**
 * Read a string-typed property off an `@Component({...})` object literal.
 * Returns the raw string value for `StringLiteral` and
 * `NoSubstitutionTemplateLiteral`, or `null` when the property is absent /
 * not a string literal (e.g. an identifier reference like `selector: SEL`).
 */
export function readDecoratorString(obj: ObjectLiteralExpression, propName: string): string | null {
  const prop = obj.getProperty(propName);
  if (!prop || !Node.isPropertyAssignment(prop)) return null;
  const init = prop.getInitializer();
  if (!init) return null;
  if (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init)) {
    return init.getLiteralText();
  }
  return null;
}

/**
 * Read a string-array property. Entries that aren't string literals are skipped
 * (so `inputs: [...SHARED, 'foo']` yields `['foo']`).
 */
export function readDecoratorStringArray(obj: ObjectLiteralExpression, propName: string): string[] {
  const prop = obj.getProperty(propName);
  if (!prop || !Node.isPropertyAssignment(prop)) return [];
  const init = prop.getInitializer();
  if (!init || !Node.isArrayLiteralExpression(init)) return [];
  const out: string[] = [];
  for (const el of init.getElements()) {
    if (Node.isStringLiteral(el) || Node.isNoSubstitutionTemplateLiteral(el)) {
      out.push(el.getLiteralText());
    }
  }
  return out;
}
