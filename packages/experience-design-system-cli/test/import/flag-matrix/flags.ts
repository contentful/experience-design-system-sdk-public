export interface FlagSpec {
  flag: string;
  kind: 'boolean' | 'value';
  sampleValue?: string;
  incompatibleWith: string[];
  notes?: string;
}

export const IMPORT_FLAGS: FlagSpec[] = [
  {
    flag: '--project',
    kind: 'value',
    sampleValue: '.',
    incompatibleWith: [],
  },
  {
    flag: '--agent',
    kind: 'value',
    sampleValue: 'claude',
    incompatibleWith: [],
  },
  {
    flag: '--model',
    kind: 'value',
    sampleValue: 'haiku',
    incompatibleWith: [],
  },
  {
    flag: '--bedrock',
    kind: 'boolean',
    incompatibleWith: [],
    notes:
      'Only valid with an agent that supports Bedrock routing (currently: claude [default], codex, opencode); rejected otherwise.',
  },
  {
    flag: '--raw-tokens',
    kind: 'value',
    sampleValue: '/tmp/raw-tokens.scss',
    incompatibleWith: [],
  },
  {
    flag: '--skip-map-tokens',
    kind: 'boolean',
    incompatibleWith: [],
  },
  {
    flag: '--no-cache',
    kind: 'boolean',
    incompatibleWith: [],
  },
  {
    flag: '--composition-map',
    kind: 'value',
    sampleValue: '/tmp/composition-map.json',
    incompatibleWith: [],
    notes: 'Consumes a hand-authored map.',
  },
  {
    flag: '--prompt',
    kind: 'value',
    sampleValue: 'composition=./p.md',
    incompatibleWith: [],
  },
];
