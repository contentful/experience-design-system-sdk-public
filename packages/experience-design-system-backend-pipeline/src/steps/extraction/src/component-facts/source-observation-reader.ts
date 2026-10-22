import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { sourceTextLocation } from '../candidates/source-location.js';
import type { SourceFactLocation } from '../candidates/types.js';
import type {
  ComponentObservationLimits,
  ComponentSourceObservationCollection,
  SourceDeclarationOrigin,
  SourceObservationType,
  SourceCallableSignature,
  SourceSymbolEvidence,
} from '../types/component-source-observations.js';
import { resolveSourceSymbolDeclarations } from '../../source-evidence/resolve-symbol-declarations.js';

export function isWithinSourceBoundary(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
export function sourceRealPath(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

/** Reads compiler evidence using the producer's existing program, with per-collection budgets. */
export class SourceObservationReader {
  private readonly locations = new Map<ts.SourceFile, SourceFactLocation>();
  private readonly symbols = new Map<ts.Symbol, SourceSymbolEvidence>();
  private readonly origins = new Map<string, SourceDeclarationOrigin>();
  private readonly manifests = new Map<string, SourceDeclarationOrigin['package'] | 'unavailable'>();
  constructor(
    readonly checker: ts.TypeChecker,
    readonly program: ts.Program,
    readonly collection: ComponentSourceObservationCollection,
  ) {}

  location(node: ts.Node): SourceFactLocation {
    const source = node.getSourceFile();
    let base = this.locations.get(source);
    if (!base) {
      base = sourceTextLocation(source.fileName, source.text, {
        startLine: 1,
        endLine: 1,
        startOffset: 0,
        endOffset: 0,
      });
      this.locations.set(source, base);
    }
    return this.range(source, node.getStart(source), node.getEnd());
  }
  range(source: ts.SourceFile, start: number, end: number): SourceFactLocation {
    const base =
      this.locations.get(source) ??
      sourceTextLocation(source.fileName, source.text, { startLine: 1, endLine: 1, startOffset: 0, endOffset: 0 });
    this.locations.set(source, base);
    return {
      ...base,
      startLine: source.getLineAndCharacterOfPosition(start).line + 1,
      endLine: source.getLineAndCharacterOfPosition(end).line + 1,
      startOffset: start,
      endOffset: end,
    };
  }
  identity(node: ts.Node): string {
    const loc = this.location(node);
    return `${loc.canonicalPath}:${loc.textHash}:${loc.startOffset}:${loc.endOffset}`;
  }
  omit(reason: string, node?: ts.Node): void {
    const location = node ? this.location(node) : null;
    const existing = this.collection.omissions.find(
      (item) =>
        item.reason === reason &&
        item.location?.canonicalPath === location?.canonicalPath &&
        item.location?.startOffset === location?.startOffset,
    );
    if (existing) existing.count += 1;
    else this.collection.omissions.push({ reason, location, count: 1 });
    this.collection.coverage = 'partial';
  }
  admit(field: keyof ComponentObservationLimits, node?: ts.Node): boolean {
    if (this.collection.used[field] >= this.collection.limits[field]) {
      this.omit(`${field}-limit`, node);
      return false;
    }
    this.collection.used[field] += 1;
    return true;
  }
  origin(node: ts.Node): SourceDeclarationOrigin {
    const path = resolve(node.getSourceFile().fileName);
    const cached = this.origins.get(path);
    if (cached) return cached;
    const real = sourceRealPath(path);
    if (!real) this.omit('realpath-unavailable', node);
    const selected = this.collection.selectedSourcePaths;
    const root = this.collection.repositoryRoot;
    let packageStatus: SourceDeclarationOrigin['packageStatus'] = 'absent';
    let pkg: SourceDeclarationOrigin['package'] = null;
    let directory = dirname(real ?? path);
    for (;;) {
      const manifestPath = resolve(directory, 'package.json');
      let manifest = this.manifests.get(manifestPath);
      if (manifest === undefined) {
        if (!this.admit('maxManifestReads', node)) {
          packageStatus = 'unavailable';
          break;
        }
        let fd: number | undefined;
        try {
          fd = openSync(manifestPath, 'r');
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('manifest-bounds');
          const bytes = Buffer.alloc(stat.size);
          let offset = 0;
          while (offset < bytes.length) {
            const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
            if (!count) break;
            offset += count;
          }
          const after = fstatSync(fd);
          if (offset !== bytes.length || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs)
            throw new Error('manifest-changed');
          const text = bytes.toString('utf8');
          const value: unknown = JSON.parse(text);
          manifest =
            value && typeof value === 'object' && 'name' in value && typeof value.name === 'string'
              ? {
                  name: value.name,
                  private: 'private' in value && typeof value.private === 'boolean' ? value.private : null,
                  publication: 'unknown',
                  manifest: sourceTextLocation(manifestPath, text, {
                    startLine: 1,
                    endLine: text.split('\n').length,
                    startOffset: 0,
                    endOffset: text.length,
                  }),
                }
              : 'unavailable';
        } catch (error) {
          manifest =
            error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? null : 'unavailable';
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
        this.manifests.set(manifestPath, manifest);
      }
      if (manifest === 'unavailable') {
        packageStatus = 'unavailable';
        this.omit('manifest-unavailable', node);
        break;
      }
      if (manifest) {
        pkg = manifest;
        packageStatus = 'resolved';
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    const value: SourceDeclarationOrigin = {
      realPath: real,
      realpathStatus: real ? 'resolved' : 'unavailable',
      selected: selected.length ? (selected.includes(real ?? path) ? 'inside' : 'outside') : 'unknown',
      repository: root ? (isWithinSourceBoundary(root, real ?? path) ? 'inside' : 'outside') : 'unknown',
      packageStatus,
      package: pkg,
    };
    this.origins.set(path, value);
    return value;
  }
  declarations(
    symbol: ts.Symbol | undefined,
    node: ts.Node,
    aliases: SourceSymbolEvidence['aliases'] = [],
  ): ts.Declaration[] {
    return resolveSourceSymbolDeclarations(this.checker, symbol, {
      admit: () => this.admit('maxReferences', node),
      alias: (declaration, aliasSymbol) => {
        if (this.admit('maxDeclarations', declaration))
          aliases.push({ name: aliasSymbol.getName(), location: this.location(declaration) });
      },
      cycle: () => this.omit('symbol-alias-cycle', node),
    });
  }
  symbol(node: ts.Node): SourceSymbolEvidence {
    const subject = ts.isPropertyAccessExpression(node) ? node.name : node;
    const symbol = this.checker.getSymbolAtLocation(subject);
    const cached = symbol && this.symbols.get(symbol);
    if (cached) return cached;
    const aliases: SourceSymbolEvidence['aliases'] = [];
    const targets = this.declarations(symbol, node, aliases);
    const declarations: SourceSymbolEvidence['declarations'] = [];
    for (const target of targets) {
      if (!this.admit('maxDeclarations', target)) break;
      declarations.push({
        id: this.identity(target),
        kind: ts.SyntaxKind[target.kind],
        location: this.location(target),
        origin: this.origin(target),
      });
    }
    if (!symbol || !targets.length) this.omit('symbol-unresolved', node);
    const value: SourceSymbolEvidence = {
      id: declarations.length
        ? declarations
            .map((target) => target.id)
            .sort()
            .join('|')
        : null,
      name: symbol?.getName() ?? node.getText(),
      resolution: !targets.length ? 'unresolved' : declarations.length !== targets.length ? 'ambiguous' : 'resolved',
      defaultLibrary: targets.length
        ? targets.every((target) => this.program.isSourceFileDefaultLibrary(target.getSourceFile()))
        : null,
      aliases,
      declarations,
    };
    if (symbol) this.symbols.set(symbol, value);
    return value;
  }
  private signature(signature: ts.Signature, node: ts.Node): SourceCallableSignature {
    const declaration = signature.getDeclaration();
    if (!declaration) this.omit('signature-declaration-unavailable', node);
    const parameters: SourceCallableSignature['parameters'] = [];
    for (const parameter of signature.parameters) {
      if (!this.admit('maxDeclarations', node)) break;
      const decl = parameter.valueDeclaration ?? parameter.declarations?.[0];
      if (!decl) this.omit('signature-parameter-declaration-unavailable', node);
      parameters.push({
        name: parameter.getName(),
        typeText: this.checker.typeToString(this.checker.getTypeOfSymbolAtLocation(parameter, decl ?? node)),
        required:
          decl && ts.isParameter(decl) ? !decl.questionToken && !decl.initializer && !decl.dotDotDotToken : null,
        location: decl ? this.location(decl) : null,
      });
    }
    return {
      declaration: declaration ? this.location(declaration) : null,
      parameters,
      returnTypeText: this.checker.typeToString(signature.getReturnType()),
    };
  }
  type(node: ts.Node): SourceObservationType {
    const type = this.checker.getTypeAtLocation(node);
    const signatures: SourceObservationType['signatures'] = [];
    for (const signature of type.getCallSignatures()) {
      if (!this.admit('maxSignatures', node)) break;
      signatures.push(this.signature(signature, node));
    }
    return { typeText: this.checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation), signatures };
  }
  callType(node: ts.CallExpression | ts.NewExpression): SourceObservationType {
    const result = this.type(node.expression);
    const signature = this.checker.getResolvedSignature(node);
    if (!signature) this.omit('call-signature-unavailable', node);
    return {
      ...result,
      resultTypeText: this.checker.typeToString(this.checker.getTypeAtLocation(node)),
      resolvedSignature: signature && this.admit('maxSignatures', node) ? this.signature(signature, node) : null,
    };
  }
}
