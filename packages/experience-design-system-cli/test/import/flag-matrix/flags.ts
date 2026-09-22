type FlagMode = 'pty';

export interface FlagSpec {
  flag: string;
  kind: 'boolean' | 'value';
  sampleValue?: string;
  modes: FlagMode[];
  incompatibleWith: string[];
  notes?: string;
}

export const IMPORT_FLAGS: FlagSpec[] = [
  {
    flag: '--project',
    kind: 'value',
    sampleValue: '.',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--agent',
    kind: 'value',
    sampleValue: 'claude',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--model',
    kind: 'value',
    sampleValue: 'haiku',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--bedrock',
    kind: 'boolean',
    modes: ['pty'],
    incompatibleWith: [],
    notes:
      'Only valid with an agent that supports Bedrock routing (currently: claude [default], codex, opencode); rejected otherwise.',
  },
  {
    flag: '--raw-tokens',
    kind: 'value',
    sampleValue: '/tmp/raw-tokens.scss',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--skip-map-tokens',
    kind: 'boolean',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--no-cache',
    kind: 'boolean',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--host',
    kind: 'value',
    sampleValue: 'http://127.0.0.1:9999',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--composite',
    kind: 'boolean',
    modes: ['pty'],
    incompatibleWith: [],
    notes: 'Composition opt-in; atomic mode remains the default.',
  },
  {
    flag: '--composition-map',
    kind: 'value',
    sampleValue: '/tmp/map.json',
    modes: ['pty'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--composition-agent',
    kind: 'boolean',
    modes: ['pty'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--composition-agent-mode',
    kind: 'value',
    sampleValue: 'parser',
    modes: ['pty'],
    incompatibleWith: [],
  },
  {
    flag: '--generate-map',
    kind: 'value',
    sampleValue: '/tmp/skeleton.json',
    modes: ['pty'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--prompt',
    kind: 'value',
    sampleValue: 'composition=./p.md',
    modes: ['pty'],
    incompatibleWith: [],
  },
];
