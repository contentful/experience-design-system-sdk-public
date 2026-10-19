import { describe, expect, it } from 'vitest';
import { createProgram } from '../program.js';
import { extractWatchFlag } from '../src/commands/watch.js';

describe('createProgram', () => {
  const names = createProgram().commands.map((command) => command.name());

  it('registers import as the only command', () => {
    expect(names).toEqual(['import']);
  });
});

describe('extractWatchFlag', () => {
  it('removes --watch and reports it', () => {
    expect(extractWatchFlag(['--watch', '--project', './src'])).toEqual({ watch: true, rest: ['--project', './src'] });
  });

  it('leaves other arguments alone when --watch is absent', () => {
    expect(extractWatchFlag(['--project', './src'])).toEqual({ watch: false, rest: ['--project', './src'] });
  });
});
