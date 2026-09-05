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
