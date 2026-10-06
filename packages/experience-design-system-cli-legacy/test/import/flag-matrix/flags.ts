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
    sampleValue: 'claude:haiku',
    incompatibleWith: [],
  },
  {
    flag: '--tokens',
    kind: 'value',
    sampleValue: '/tmp/tokens.scss',
    incompatibleWith: [],
  },
  {
    flag: '--no-cache',
    kind: 'boolean',
    incompatibleWith: [],
  },
  {
    flag: '--prompt',
    kind: 'value',
    sampleValue: 'composition=./p.md',
    incompatibleWith: [],
  },
  {
    flag: '--skip-token-prompt',
    kind: 'boolean',
    incompatibleWith: [],
    notes: 'Hidden. The new CLI passes it after the user skips its own token step.',
  },
];
