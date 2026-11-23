import { Node, type ClassDeclaration } from 'ts-morph';

export interface AngularContentQueryObservation {
  name: string;
  declaration: string;
  sourcePath: string;
  startLine: number;
}

export function extractContentChildQueries(cls: ClassDeclaration): AngularContentQueryObservation[] {
  const out: AngularContentQueryObservation[] = [];

  for (const field of cls.getProperties()) {
    const init = field.getInitializer();
    const signalQuery =
      init && Node.isCallExpression(init) && Node.isIdentifier(init.getExpression())
        ? ['contentChild', 'contentChildren'].includes(init.getExpression().getText())
        : false;
    const decoratorQuery = field.getDecorator('ContentChild') ?? field.getDecorator('ContentChildren');
    if (!signalQuery && !decoratorQuery) continue;
    out.push({
      name: field.getName(),
      declaration: field.getText(),
      sourcePath: field.getSourceFile().getFilePath(),
      startLine: field.getStartLineNumber(),
    });
  }

  return out;
}
