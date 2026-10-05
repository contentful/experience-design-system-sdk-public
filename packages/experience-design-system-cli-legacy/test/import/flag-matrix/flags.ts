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
    flag: '--prompt',
    kind: 'value',
    sampleValue: 'composition=./p.md',
    incompatibleWith: [],
  },
];
