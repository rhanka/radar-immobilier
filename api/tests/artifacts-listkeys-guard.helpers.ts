import ts from "typescript";
import { readdirSync } from "node:fs";
import { join } from "node:path";

type ReadDirectory = (path: string) => readonly { name: string; isDirectory(): boolean }[];
export const excludedTestDirectories = ["node_modules", ".git"];

export function testFiles(directory: string, readDirectory: ReadDirectory =
  (path) => readdirSync(path, { withFileTypes: true })): string[] {
  return readDirectory(directory).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return excludedTestDirectories.includes(entry.name) ? [] : testFiles(path, readDirectory);
    }
    return /\.(?:spec|test|helpers)\.ts$/.test(entry.name) ? [path] : [];
  });
}

export function repositoryTestFiles(root: string, readDirectory: ReadDirectory =
  (path) => readdirSync(path, { withFileTypes: true })): string[] {
  const packages = join(root, "packages");
  return [...testFiles(join(root, "api"), readDirectory),
    ...readDirectory(packages).filter((entry) => entry.isDirectory() && !excludedTestDirectories.includes(entry.name))
      .flatMap((entry) => testFiles(join(packages, entry.name), readDirectory))].sort();
}

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

  function unwrap(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node)) node = node.expression;
    return node;
  }

  function staticString(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    node = unwrap(node);
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
      const callee = unwrap(node.expression);
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
