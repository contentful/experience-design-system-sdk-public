import { Node, type ObjectLiteralExpression } from 'ts-morph';

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
