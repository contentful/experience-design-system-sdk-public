import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  addArtifactInputOptions,
  addCompositionOptions,
  addContentfulTargetOptions,
  addSelectionOptions,
  COMPOSITION_MODES,
  CONFLICT_MODES,
  isCompositionMode,
  isConflictMode,
} from '../../src/lib/command-options.js';

function options(command: Command) {
  return command.options.map((option) => ({
    flag: option.long,
    description: option.description,
    mandatory: option.mandatory,
    defaultValue: option.defaultValue,
  }));
}

describe('command option builders', () => {
  it('defines composition modes as runtime values', () => {
    expect(COMPOSITION_MODES).toEqual(['composite', 'atomic']);
    expect(isCompositionMode('composite')).toBe(true);
    expect(isCompositionMode('atomic')).toBe(true);
    expect(isCompositionMode('flat')).toBe(false);
  });

  it('defines and validates conflict modes as runtime values', () => {
    expect(CONFLICT_MODES).toEqual(['overwrite', 'skip', 'fail']);
    expect(isConflictMode('overwrite')).toBe(true);
    expect(isConflictMode('skip')).toBe(true);
    expect(isConflictMode('fail')).toBe(true);
    expect(isConflictMode('replace')).toBe(false);
  });

  it('registers artifact inputs with their existing help text', () => {
    const command = addArtifactInputOptions(new Command());
    expect(options(command)).toEqual([
      { flag: '--components', description: 'Path to components.json (CDF)', mandatory: false, defaultValue: undefined },
      { flag: '--tokens', description: 'Path to tokens.json (DTCG)', mandatory: false, defaultValue: undefined },
      {
        flag: '--session',
        description: 'Pipeline session ID to load generated components from',
        mandatory: false,
        defaultValue: undefined,
      },
    ]);
  });

  it('registers required Contentful target options with their existing help text', () => {
    const command = addContentfulTargetOptions(new Command());
    expect(options(command)).toEqual([
      { flag: '--space-id', description: 'Contentful space ID', mandatory: true, defaultValue: undefined },
      { flag: '--environment-id', description: 'Contentful environment ID', mandatory: true, defaultValue: undefined },
      {
        flag: '--cma-token',
        description: 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)',
        mandatory: false,
        defaultValue: undefined,
      },
      { flag: '--host', description: 'Override API base URL', mandatory: false, defaultValue: undefined },
    ]);
  });

  it('registers composition flags with their existing help text', () => {
    const command = addCompositionOptions(new Command());
    expect(options(command)).toEqual([
      {
        flag: '--composite',
        description: 'Import embedded-component hierarchy (opt in; default is atomic)',
        mandatory: false,
        defaultValue: undefined,
      },
      {
        flag: '--atomic',
        description: 'Import flat components with no embedded-component hierarchy (default)',
        mandatory: false,
        defaultValue: undefined,
      },
    ]);
  });

  it('collects repeated selection patterns with existing defaults', () => {
    const command = addSelectionOptions(new Command());
    command.parse(['node', 'test', '--select', 'Button', '--select', 'Card', '--deselect', 'Icon']);
    expect(command.opts()).toMatchObject({ select: ['Button', 'Card'], deselect: ['Icon'] });
    expect(options(command)).toEqual([
      {
        flag: '--select-all',
        description: 'Select all entities without launching TUI',
        mandatory: false,
        defaultValue: undefined,
      },
      {
        flag: '--select',
        description: 'Select entities by ID pattern (repeatable)',
        mandatory: false,
        defaultValue: [],
      },
      {
        flag: '--deselect',
        description: 'Deselect entities by ID pattern (repeatable)',
        mandatory: false,
        defaultValue: [],
      },
    ]);
  });
});
