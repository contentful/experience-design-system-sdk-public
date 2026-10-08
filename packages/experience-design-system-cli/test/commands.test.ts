import { describe, expect, it } from 'vitest';
import { createProgram } from '../program.js';
import { extractWatchFlag } from '../src/commands/watch.js';

describe('createProgram', () => {
  const names = createProgram().commands.map((command) => command.name());

  it('registers import as the default command plus every forwarded command', () => {
    expect(names).toEqual(['import', 'apply', 'setup', 'doctor', 'print', 'map', '__extract', '__generate']);
  });

  it('hides the internal forwarded commands from help', () => {
    const hidden = createProgram()
      .commands.filter((command) => (command as unknown as { _hidden: boolean })._hidden)
      .map((command) => command.name());
    expect(hidden).toEqual(['print', 'map', '__extract', '__generate']);
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
