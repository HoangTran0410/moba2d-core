import ts from 'typescript';

/**
 * The parser, for seams that ban a *shape in code* rather than a word in prose.
 *
 * Most seams in this directory match source as text, which is the right tool
 * for the ones that are genuinely about text — a champion's name appearing in a
 * core comment, an import specifier spelled a certain way. It is the wrong tool
 * for a rule about what the code *does*, and the difference is measurable: the
 * `dashOnUpdate` ban was given four ways to write the thing it forbids and
 * caught **one**. It missed `dash['onUpdate'] = ...`, it missed
 * `Object.assign(dash, { onUpdate })`, and it missed a line break before the
 * property — which is not an evasion at all, just what a formatter does to a
 * long line.
 *
 * A syntactic ban needs no type checker and no `tsconfig`: one file parsed on
 * its own answers it, in about a millisecond. Seams that need to resolve a name
 * across files want `ts.createProgram` instead — `scripts/perf-scan.mjs` is the
 * worked example of that, and it costs about a second.
 */
export const parse = (source: string, fileName = 'seam.ts'): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);

/** Every node under `root`, in source order. */
export function walkAst(root: ts.Node, visit: (node: ts.Node) => void): void {
  visit(root);
  ts.forEachChild(root, child => walkAst(child, visit));
}

/** 1-based line of a node, for a message a reader can jump to. */
export const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/** The property name a node reads or writes, however it is spelled. */
const propertyNameOf = (node: ts.Node): string | null => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
};

/** One place a property is given a value, and the source that did it. */
export interface PropertyWrite {
  node: ts.Node;
  /** A short rendering of the offending expression, for the violation message. */
  text: string;
  line: number;
}

/**
 * Every way this file gives `property` a value on some object.
 *
 * Covers the three shapes a text scan cannot see past — bracket access, an
 * `Object.assign` payload, and a property access split over two lines — as well
 * as the ordinary `x.property =`. A *declaration* of a method with that name is
 * deliberately not a write: that is how a class defines the thing being
 * protected, and banning it would ban the base class.
 */
export function propertyWrites(sourceFile: ts.SourceFile, property: string): PropertyWrite[] {
  const found: PropertyWrite[] = [];
  const record = (node: ts.Node, text: string) =>
    found.push({ node, text, line: lineOf(sourceFile, node) });

  walkAst(sourceFile, node => {
    // `x.onUpdate = ...` and `x['onUpdate'] = ...`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      propertyNameOf(node.left) === property
    ) {
      record(node, `${node.left.getText(sourceFile).replace(/\s+/g, '')} =`);
      return;
    }
    // `Object.assign(target, { onUpdate: ... })`
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'assign' &&
      node.expression.expression.getText(sourceFile) === 'Object'
    ) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const member of argument.properties) {
          const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
          if (name === property) record(member, `Object.assign(…, { ${property} })`);
        }
      }
    }
  });
  return found;
}

/**
 * The number an expression amounts to, or `null` when it is not knowable from
 * this file alone.
 *
 * Constants declared here are followed, and so is plain arithmetic on them —
 * `30 * 1000` and `8 * SECOND` are how a readable file writes a duration. A
 * name imported from elsewhere is *not* followed: that needs a program, and a
 * syntactic seam that suddenly required a `tsconfig` would cost a second per
 * pack to catch a case the packs do not currently write.
 */
export function numericValueOf(
  node: ts.Node | undefined,
  constants: Map<string, ts.Expression>,
  depth = 0
): number | null {
  if (!node || depth > 8) return null;
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll('_', ''));
  if (ts.isParenthesizedExpression(node)) return numericValueOf(node.expression, constants, depth + 1);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const inner = numericValueOf(node.operand, constants, depth + 1);
    return inner === null ? null : -inner;
  }
  if (ts.isIdentifier(node)) {
    const declared = constants.get(node.text);
    return declared ? numericValueOf(declared, constants, depth + 1) : null;
  }
  if (ts.isBinaryExpression(node)) {
    const left = numericValueOf(node.left, constants, depth + 1);
    const right = numericValueOf(node.right, constants, depth + 1);
    if (left === null || right === null) return null;
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
        return left + right;
      case ts.SyntaxKind.MinusToken:
        return left - right;
      case ts.SyntaxKind.AsteriskToken:
        return left * right;
      case ts.SyntaxKind.SlashToken:
        return right === 0 ? null : left / right;
      default:
        return null;
    }
  }
  return null;
}

/** Every `const name = <expression>` in a file, for `numericValueOf` to follow. */
export function constantsOf(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();
  walkAst(sourceFile, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (!constants.has(node.name.text)) constants.set(node.name.text, node.initializer);
    }
  });
  return constants;
}

/** Every value a named property is initialised or assigned to, with its line. */
export function propertyValues(
  sourceFile: ts.SourceFile,
  property: string
): { expression: ts.Expression; line: number }[] {
  const found: { expression: ts.Expression; line: number }[] = [];
  walkAst(sourceFile, node => {
    if (ts.isPropertyDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      if (node.name.text === property && node.initializer) {
        found.push({ expression: node.initializer, line: lineOf(sourceFile, node) });
      }
      return;
    }
    // `x.coolDown = …`, and a bare `coolDown = …` — the second is what a
    // minimal fixture writes, and what a plain assignment outside a class is.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ((ts.isPropertyAccessExpression(node.left) && node.left.name.text === property) ||
        (ts.isIdentifier(node.left) && node.left.text === property))
    ) {
      found.push({ expression: node.right, line: lineOf(sourceFile, node) });
      return;
    }
    // `{ coolDown: … }` — the shape a config object uses.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === property
    ) {
      found.push({ expression: node.initializer, line: lineOf(sourceFile, node) });
    }
  });
  return found;
}
