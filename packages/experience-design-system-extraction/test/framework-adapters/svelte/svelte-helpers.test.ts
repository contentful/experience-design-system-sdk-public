import { describe, expect, it } from 'vitest';
import {
  hasV4ExportLetProps,
  findPropsCall,
  collectSnippetImportLocals,
  findLocalTypeDeclaration,
  declarationHasHeritage,
  mergeSets,
} from '../../../src/extract/framework-adapters/svelte/helpers/find-svelte-script-declarations.js';
import {
  isSnippetTypeText,
  renderType,
  renderLiteral,
  extractAllowedValuesFromText,
  extractJsdocText,
} from '../../../src/extract/framework-adapters/svelte/helpers/render-svelte-type.js';
import type { AstNode } from '../../../src/extract/framework-adapters/svelte/types/svelte-ast-node.js';

function makeBody(stmts: object[]): AstNode {
  return { type: 'Script', content: { body: stmts } } as unknown as AstNode;
}

describe('hasV4ExportLetProps', () => {
  it('returns true when instance has export let declaration', () => {
    const instance = makeBody([
      {
        type: 'ExportNamedDeclaration',
        declaration: { type: 'VariableDeclaration', kind: 'let' },
      },
    ]);
    expect(hasV4ExportLetProps(instance)).toBe(true);
  });

  it('returns false when instance has export const declaration', () => {
    const instance = makeBody([
      {
        type: 'ExportNamedDeclaration',
        declaration: { type: 'VariableDeclaration', kind: 'const' },
      },
    ]);
    expect(hasV4ExportLetProps(instance)).toBe(false);
  });

  it('returns false for empty body', () => {
    expect(hasV4ExportLetProps(makeBody([]))).toBe(false);
  });
});

describe('findPropsCall', () => {
  it('finds a $props() variable declaration', () => {
    const instance = makeBody([
      {
        type: 'VariableDeclaration',
        declarations: [
          {
            type: 'VariableDeclarator',
            id: { type: 'ObjectPattern', properties: [] },
            init: { type: 'CallExpression', callee: { type: 'Identifier', name: '$props' } },
          },
        ],
      },
    ]);
    const result = findPropsCall(instance);
    expect(result).not.toBeNull();
  });

  it('returns null when no $props() call', () => {
    const instance = makeBody([{ type: 'ExpressionStatement', expression: {} }]);
    expect(findPropsCall(instance)).toBeNull();
  });
});

describe('collectSnippetImportLocals', () => {
  it('collects the local name for a Snippet import from svelte', () => {
    const instance = makeBody([
      {
        type: 'ImportDeclaration',
        source: { value: 'svelte' },
        specifiers: [
          {
            type: 'ImportSpecifier',
            imported: { name: 'Snippet' },
            local: { name: 'Snippet' },
          },
        ],
      },
    ]);
    expect(collectSnippetImportLocals(instance)).toEqual(new Set(['Snippet']));
  });

  it('uses the local alias when present', () => {
    const instance = makeBody([
      {
        type: 'ImportDeclaration',
        source: { value: 'svelte' },
        specifiers: [
          {
            type: 'ImportSpecifier',
            imported: { name: 'Snippet' },
            local: { name: 'SvelteSnippet' },
          },
        ],
      },
    ]);
    expect(collectSnippetImportLocals(instance)).toEqual(new Set(['SvelteSnippet']));
  });

  it('returns empty set for non-svelte imports', () => {
    const instance = makeBody([
      {
        type: 'ImportDeclaration',
        source: { value: 'react' },
        specifiers: [{ type: 'ImportSpecifier', imported: { name: 'Snippet' }, local: { name: 'Snippet' } }],
      },
    ]);
    expect(collectSnippetImportLocals(instance)).toEqual(new Set());
  });
});

describe('findLocalTypeDeclaration', () => {
  it('finds a TSInterfaceDeclaration by name', () => {
    const instance = makeBody([
      { type: 'TSInterfaceDeclaration', id: { name: 'Props' } },
    ]);
    const result = findLocalTypeDeclaration(instance, 'Props');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('TSInterfaceDeclaration');
  });

  it('returns null when type not found', () => {
    const instance = makeBody([]);
    expect(findLocalTypeDeclaration(instance, 'Missing')).toBeNull();
  });
});

describe('declarationHasHeritage', () => {
  it('returns true for interface with extends', () => {
    const decl = {
      type: 'TSInterfaceDeclaration',
      extends: [{ type: 'TSExpressionWithTypeArguments' }],
    } as unknown as AstNode;
    expect(declarationHasHeritage(decl)).toBe(true);
  });

  it('returns false for interface with empty extends', () => {
    const decl = { type: 'TSInterfaceDeclaration', extends: [] } as unknown as AstNode;
    expect(declarationHasHeritage(decl)).toBe(false);
  });
});

describe('mergeSets', () => {
  it('combines elements from both sets', () => {
    const a = new Set([1, 2]);
    const b = new Set([2, 3]);
    const result = mergeSets(a, b);
    expect(result).toEqual(new Set([1, 2, 3]));
  });
});

describe('isSnippetTypeText', () => {
  it('returns true for "Snippet"', () => {
    expect(isSnippetTypeText('Snippet', new Set())).toBe(true);
  });

  it('returns true for "Snippet<[...]>"', () => {
    expect(isSnippetTypeText('Snippet<[string]>', new Set())).toBe(true);
  });

  it('returns true for a local alias', () => {
    expect(isSnippetTypeText('SvelteSnippet', new Set(['SvelteSnippet']))).toBe(true);
  });

  it('returns false for a plain type', () => {
    expect(isSnippetTypeText('string', new Set())).toBe(false);
  });
});

describe('renderType', () => {
  it('renders TSStringKeyword as "string"', () => {
    expect(renderType({ type: 'TSStringKeyword' } as AstNode)).toBe('string');
  });

  it('renders TSBooleanKeyword as "boolean"', () => {
    expect(renderType({ type: 'TSBooleanKeyword' } as AstNode)).toBe('boolean');
  });

  it('renders TSArrayType', () => {
    expect(renderType({ type: 'TSArrayType', elementType: { type: 'TSNumberKeyword' } } as unknown as AstNode)).toBe('number[]');
  });

  it('returns "unknown" for undefined', () => {
    expect(renderType(undefined)).toBe('unknown');
  });

  it('renders TSUnionType', () => {
    const typeNode = {
      type: 'TSUnionType',
      types: [{ type: 'TSStringKeyword' }, { type: 'TSNullKeyword' }],
    } as unknown as AstNode;
    expect(renderType(typeNode)).toBe('string | null');
  });
});

describe('renderLiteral', () => {
  it('renders a string literal', () => {
    expect(renderLiteral({ type: 'Literal', value: 'hello' } as unknown as AstNode)).toBe("'hello'");
  });

  it('renders a number literal using raw', () => {
    expect(renderLiteral({ type: 'Literal', raw: '42' } as unknown as AstNode)).toBe('42');
  });

  it('renders an identifier', () => {
    expect(renderLiteral({ type: 'Identifier', name: 'undefined' } as unknown as AstNode)).toBe('undefined');
  });

  it('returns undefined for unrecognized node type', () => {
    expect(renderLiteral({ type: 'Unknown' } as unknown as AstNode)).toBeUndefined();
  });
});

describe('extractAllowedValuesFromText', () => {
  it('extracts string literals from a union type', () => {
    expect(extractAllowedValuesFromText("'a' | 'b' | 'c'")).toEqual(['a', 'b', 'c']);
  });

  it('returns undefined if the union has a non-literal member', () => {
    expect(extractAllowedValuesFromText("'a' | string")).toBeUndefined();
  });

  it('returns undefined for a non-union type', () => {
    expect(extractAllowedValuesFromText('string')).toBeUndefined();
  });
});

describe('extractJsdocText', () => {
  it('extracts description from a JSDoc block comment', () => {
    const comments = [{ type: 'Block' as const, value: '* The label for the button ' }];
    expect(extractJsdocText(comments)).toBe('The label for the button');
  });

  it('returns undefined for line comments', () => {
    const comments = [{ type: 'Line' as const, value: ' inline comment' }];
    expect(extractJsdocText(comments)).toBeUndefined();
  });

  it('returns undefined for empty array', () => {
    expect(extractJsdocText([])).toBeUndefined();
  });
});
