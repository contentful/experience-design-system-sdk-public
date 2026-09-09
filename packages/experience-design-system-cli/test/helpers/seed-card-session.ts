import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  storeCDFComponents,
  storeDTCGTokens,
  createStep,
  updateStep,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

/** Card's `bgColor` design-token prop, `label` a plain content string. */
const CARD: RawComponentDefinition[] = [
  {
    name: 'Card',
    source: 'src/Card.tsx',
    framework: 'react',
    props: [
      { name: 'bgColor', type: 'string', required: false, category: 'design' },
      { name: 'label', type: 'string', required: true, category: 'content' },
    ],
    slots: [],
  },
];

/** Same shape, with `bgColor` defaulting to a raw token alias instead of a literal. */
const CARD_WITH_ALIAS_DEFAULT: RawComponentDefinition[] = [
  {
    ...CARD[0]!,
    props: [
      { ...CARD[0]!.props[0]!, defaultValue: 'tokens.surfaceDefault' },
      CARD[0]!.props[1]!,
    ],
  },
];

const CARD_CDF = [
  {
    key: 'Card',
    entry: {
      $type: 'component' as const,
      $properties: {
        bgColor: { $type: 'token' as const, $category: 'design' as const, '$token.kind': 'color' },
        label: { $type: 'string' as const, $category: 'content' as const },
      },
    },
  },
];

const DEFAULT_TOKENS = [
  { path: 'colors.surface.default', $type: 'color' as const, $value: '#fff' },
  { path: 'colors.surface.raised', $type: 'color' as const, $value: '#eee' },
];

const ALIAS_DEFAULT_TOKENS = [
  { path: 'colors.surface.surface-default', $type: 'color' as const, $value: '#fff' },
  { path: 'colors.surface.default', $type: 'color' as const, $value: '#fafafa' },
  { path: 'colors.surface.raised', $type: 'color' as const, $value: '#eee' },
];

export interface SeedCardSessionOptions {
  /** Seed a `bgColor` default that aliases a raw token name instead of a literal value. Default false. */
  aliasDefault?: boolean;
  /** Store `raw_tokens` alongside the component (skip to test the "no tokens yet" path). Default true. */
  withTokens?: boolean;
  /** Record a completed `generate components` step. Default true; some tests need a session with no step recorded. */
  withStep?: boolean;
}

/**
 * Seeds a pipeline DB with the Card/bgColor/label fixture shared across the
 * map-tokens tests, opening the DB itself and returning the session id.
 * Caller is responsible for closing the DB it gets back via `openPipelineDb(dbPath)`.
 */
export function seedCardSession(dbPath: string, options: SeedCardSessionOptions = {}): string {
  const { aliasDefault = false, withTokens = true, withStep = true } = options;

  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, aliasDefault ? CARD_WITH_ALIAS_DEFAULT : CARD);
  storeCDFComponents(db, sessionId, CARD_CDF);
  if (withTokens) {
    storeDTCGTokens(db, sessionId, [], aliasDefault ? ALIAS_DEFAULT_TOKENS : DEFAULT_TOKENS);
  }
  if (withStep) {
    const stepId = createStep(db, sessionId, 'generate components', {});
    updateStep(db, stepId, 'complete', { sessionId });
  }
  db.close();
  return sessionId;
}
