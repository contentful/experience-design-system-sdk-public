import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandTilde, normalizePath } from '../../../src/tui/import/input/path.js';

const HOME = homedir();

describe('expandTilde', () => {
  it('expands ~ alone to the home directory', () => {
    expect(expandTilde('~')).toBe(HOME);
  });

  it('expands ~/foo to <home>/foo', () => {
    expect(expandTilde('~/projects/mylib')).toBe(`${HOME}/projects/mylib`);
  });

  it('expands ~\\foo on windows-style paths', () => {
    expect(expandTilde('~\\projects\\mylib')).toBe(`${HOME}\\projects\\mylib`);
  });

  it('leaves absolute and relative paths unchanged', () => {
    expect(expandTilde('/Users/ryun/projects/mylib')).toBe('/Users/ryun/projects/mylib');
    expect(expandTilde('../mylib')).toBe('../mylib');
    expect(expandTilde('./src')).toBe('./src');
    expect(expandTilde('src')).toBe('src');
  });

  it('does not expand ~username paths, which are not supported', () => {
    expect(expandTilde('~otheruser/projects')).toBe('~otheruser/projects');
  });
});

describe('normalizePath', () => {
  it('expands ~ to an absolute home path', () => {
    expect(normalizePath('~')).toBe(HOME);
    expect(normalizePath('~/projects/mylib')).toBe(`${HOME}/projects/mylib`);
  });

  it('resolves relative paths against the working directory', () => {
    expect(normalizePath('./src')).toBe(resolve('./src'));
    expect(normalizePath('../mylib')).toBe(resolve('../mylib'));
    expect(normalizePath('mylib')).toBe(resolve('mylib'));
  });

  it('passes absolute paths through unchanged', () => {
    expect(normalizePath('/Users/ryun/projects/mylib')).toBe('/Users/ryun/projects/mylib');
  });

  it('strips surrounding double quotes', () => {
    expect(normalizePath('"/Users/ryun/my lib"')).toBe('/Users/ryun/my lib');
    expect(normalizePath('"~/projects/mylib"')).toBe(`${HOME}/projects/mylib`);
  });

  it('strips surrounding single quotes', () => {
    expect(normalizePath("'/Users/ryun/my lib'")).toBe('/Users/ryun/my lib');
    expect(normalizePath("'~/projects/mylib'")).toBe(`${HOME}/projects/mylib`);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizePath('  ~/projects/mylib  ')).toBe(`${HOME}/projects/mylib`);
  });

  it('drops trailing slashes', () => {
    expect(normalizePath('/Users/ryun/mylib/')).toBe('/Users/ryun/mylib');
  });

  it('treats ~username as a relative path', () => {
    expect(normalizePath('~otheruser/projects')).toBe(resolve('~otheruser/projects'));
  });
});
