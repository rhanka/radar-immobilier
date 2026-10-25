import ts from "typescript";

export function analyzeListCalls(source: string, filename = "test.ts"): {
  invalid: number[];
  nonStatic: { line: number; expression: string }[];
} {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => name === filename ? file : undefined;
  const checker = ts.createProgram([filename], options, host).getTypeChecker();
  const invalid: number[] = [];
  const nonStatic: { line: number; expression: string }[] = [];

  function staticString(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node)) return staticString(node.expression, seen);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = staticString(node.left, seen);
      const right = staticString(node.right, seen);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const value = staticString(span.expression, seen);
        if (value === undefined) return undefined;
        result += value + span.literal.text;
      }
      return result;
    }
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer &&
          ts.isIdentifier(declaration.name) && ts.isVariableDeclarationList(declaration.parent) &&
          (declaration.parent.flags & ts.NodeFlags.Const) !== 0 && !seen.has(declaration)) {
        return staticString(declaration.initializer, new Set([...seen, declaration]));
      }
    }
    return undefined;
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) ? staticString(callee.argumentExpression) : undefined;
      if (name === "listKeys") {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const prefix = node.arguments[0];
        const value = prefix === undefined ? "" : staticString(prefix);
        if (value === "") invalid.push(line);
        else if (value === undefined && prefix) nonStatic.push({ line, expression: prefix.getText(file) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { invalid, nonStatic };
}
