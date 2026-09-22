type FlagMode = 'pty' | 'headless';

export interface FlagSpec {
  flag: string;
  kind: 'boolean' | 'value';
  sampleValue?: string;
  modes: FlagMode[];
  incompatibleWith: string[];
  forcesHeadless?: boolean;
  requiresCredentials?: boolean;
  notes?: string;
}

export const COMPOSITION_FLAGS = [
  '--composite',
  '--atomic',
  '--composition-map',
  '--composition-agent',
  '--composition-refresh',
  '--generate-map',
  '--prompt',
] as const;

export const IMPORT_FLAGS: FlagSpec[] = [
  {
    flag: '--project',
    kind: 'value',
    sampleValue: '.',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--out',
    kind: 'value',
    sampleValue: '/tmp/eds-out',
    modes: ['headless'],
    incompatibleWith: [],
    notes: 'Headless-only artifact directory; the wizard manages its own output.',
  },
  {
    flag: '--agent',
    kind: 'value',
    sampleValue: 'claude',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--model',
    kind: 'value',
    sampleValue: 'haiku',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--bedrock',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes:
      'Only valid with an agent that supports Bedrock routing (currently: claude [default], codex, opencode); rejected otherwise.',
  },
  {
    flag: '--raw-tokens',
    kind: 'value',
    sampleValue: '/tmp/raw-tokens.scss',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--skip-map-tokens',
    kind: 'boolean',
    modes: ['headless'],
    incompatibleWith: [],
  },
  {
    flag: '--no-cache',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--host',
    kind: 'value',
    sampleValue: 'http://127.0.0.1:9999',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
  {
    flag: '--composite',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Composition opt-in; wins over --atomic when both are passed (precedence, not an error).',
  },
  {
    flag: '--atomic',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Default mode. Accepted for symmetry; --composite wins if both passed.',
  },
  {
    flag: '--composition-map',
    kind: 'value',
    sampleValue: '/tmp/map.json',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--composition-agent',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--composition-refresh',
    kind: 'boolean',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--generate-map',
    kind: 'value',
    sampleValue: '/tmp/skeleton.json',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
    notes: 'Implies --composite.',
  },
  {
    flag: '--prompt',
    kind: 'value',
    sampleValue: 'composition=./p.md',
    modes: ['pty', 'headless'],
    incompatibleWith: [],
  },
];
