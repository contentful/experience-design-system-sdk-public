import ts from 'typescript';
import { createHash } from 'node:crypto';
import type { SourceFieldSemantics } from '../../../../steps/extraction/src/types/field-semantics.js';
import { collectFieldReplay } from '../../../../steps/extraction/src/component-facts/collect-field-replay.js';
import { fieldReplayIdentity, type SourceFieldReplay } from '../../../../steps/extraction/src/types/field-replay.js';
import type { SourceCapture } from '../../../../steps/extraction/source-evidence/types.js';

/** Recompute the paired derivation from the accepted capture only, without filesystem/compiler reads. */
export function validateSavedFieldReplay(
  semantics: SourceFieldSemantics,
  files: SourceCapture['files'],
): SourceFieldSemantics {
  const certificate = semantics.relationalReplay;
  if (!certificate) return semantics;
  function withheld(status: 'unavailable' | 'mismatch'): SourceFieldSemantics {
    const reason = `paired-replay-${status}`;
    const checked: SourceFieldReplay = {
      ...certificate!,
      status,
      results: certificate!.results.map((result) => ({
        ...result,
        valueComparison: { left: null, right: null },
        omissionComparison: { left: null, right: null },
        valueIndependence: { status: 'unknown', premises: [], reasons: [reason] },
        omissionSafety: { status: 'unknown', premises: [], reasons: [reason] },
        reasons: [...new Set([...result.reasons, reason])],
      })),
    };
    checked.identity = fieldReplayIdentity(checked);
    return { ...semantics, relationalReplay: checked };
  }
  const location = semantics.source;
  const matches = files.filter((file) => file.canonicalPath === location.canonicalPath);
  const file = matches.length === 1 ? matches[0] : undefined;
  if (
    location.binding !== 'verified' ||
    !file ||
    file.captured.kind !== 'full' ||
    !location.textHash ||
    location.textHash !== file.textHash ||
    typeof location.startOffset !== 'number' ||
    typeof location.endOffset !== 'number'
  )
    return withheld('unavailable');
  const text = file.captured.text;
  if (Buffer.byteLength(text) > 256 * 1024) return withheld('unavailable');
  if (createHash('sha256').update(text).digest('hex') !== location.textHash) return withheld('mismatch');
  const source = ts.createSourceFile(
    file.canonicalPath,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?tsx?$|\.[cm]?jsx?$/.test(file.canonicalPath) && /x$/.test(file.canonicalPath)
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length)
    return withheld('unavailable');
  let target: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined;
  let nodes = 0;
  let exhausted = false;
  const find = (node: ts.Node, depth: number): void => {
    if (target || exhausted) return;
    if (++nodes > certificate!.limits.maxNodes || depth > certificate!.limits.maxDepth) {
      exhausted = true;
      return;
    }
    if (node.getEnd() < location.startOffset! || node.getStart(source) > location.endOffset!) return;
    if (
      node.getStart(source) === location.startOffset &&
      node.getEnd() === location.endOffset &&
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node))
    ) {
      target = node;
      return;
    }
    ts.forEachChild(node, (child) => find(child, depth + 1));
  };
  find(source, 0);
  if (exhausted) return withheld('unavailable');
  if (!target) return withheld('mismatch');
  const host: ts.CompilerHost = {
    getSourceFile: (path) => (path === file.canonicalPath ? source : undefined),
    getDefaultLibFileName: () => '',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    getCanonicalFileName: (path) => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (path) => path === file.canonicalPath,
    readFile: (path) => (path === file.canonicalPath ? text : undefined),
  };
  const program = ts.createProgram(
    [file.canonicalPath],
    { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve },
    host,
  );
  const replay = collectFieldReplay(target, semantics, certificate.limits, undefined, program.getTypeChecker());
  if (replay.identity !== certificate.identity) return withheld('mismatch');
  return { ...semantics, relationalReplay: { ...replay, status: 'matched' } };
}
