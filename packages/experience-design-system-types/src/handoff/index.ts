import * as z from 'zod/mini';

// What the new CLI has already done when it starts the legacy import wizard. It is passed once, in one environment
// variable, and holds paths, ids and statuses only: no credentials (the wizard reads those from the config file).
//
// Every stage that moves from the wizard to the CLI adds its results here as another optional section, and the wizard
// stops producing them itself. When the wizard is deleted, so is this file.
export const HANDOFF_ENV = 'EDS_IMPORT_HANDOFF';

const NonEmpty = z.string().check(z.minLength(1));

const TokensSchema = z.object({
  /**
   * What to do about an existing `tokens.json`.
   * reuse: keep it. regenerate: build it again with the cache off. generate: nothing was asked, build it as usual.
   */
  strategy: z.enum(['reuse', 'regenerate', 'generate']),
});

const ExtractionSchema = z.object({
  sessionId: NonEmpty,
  outDir: NonEmpty,
  tokensPath: z.string(),
  tokenSessionId: z.nullable(z.string()),
  tokenCount: z.number(),
  existingEntitiesPath: z.nullable(z.string()),
  /** Never 'running': the wizard starts its background cache check only once this has settled. */
  existingEntitiesStatus: z.enum(['idle', 'complete', 'failed']),
  /** The only phases the scope gate can start from. */
  compositionPhase: z.enum(['done', 'cache-hit']),
});

const ScopeSchema = z.object({
  /** The components the user kept at the scope gate. The wizard saves these, then generates them. */
  accepted: z.array(z.string()),
  /** Everything else at the gate, which counts as rejected. */
  rejected: z.array(z.string()),
  /**
   * Components the generation cache already holds, found by the check that ran while the gate was open and which has
   * finished (and restored them) before the wizard starts. Empty when the cache is off or the check failed.
   */
  cachedNames: z.array(z.string()),
});

const ImportHandoffSchema = z.object({
  /** The user skipped the credentials screen, so nothing is fetched from or pushed to Contentful. */
  credentialsSkipped: z.boolean(),
  tokens: TokensSchema,
  /** Present once the CLI has run the extraction stage; the wizard then starts at the scope gate. */
  extraction: z.optional(ExtractionSchema),
  /** Present once the user has confirmed the scope gate; the wizard then saves the decisions and starts generating. */
  scope: z.optional(ScopeSchema),
});

export type ImportHandoff = z.infer<typeof ImportHandoffSchema>;
export type ExtractionHandoff = NonNullable<ImportHandoff['extraction']>;
export type ScopeHandoff = NonNullable<ImportHandoff['scope']>;

export type ParsedHandoff = { ok: true; handoff: ImportHandoff } | { ok: false; error: string };

export function serializeHandoff(handoff: ImportHandoff): string {
  return JSON.stringify(handoff);
}

/** Reads the handoff from the variable's value. Never throws: a bad handoff comes back as an error to show. */
export function parseHandoff(raw: string | undefined): ParsedHandoff {
  if (!raw)
    return { ok: false, error: `${HANDOFF_ENV} is not set. The legacy import wizard must be started by the CLI.` };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: `${HANDOFF_ENV} is not valid JSON.` };
  }

  const result = z.safeParse(ImportHandoffSchema, json);
  if (result.success) return { ok: true, handoff: result.data };

  const problems = result.error.issues.map((issue) => `${issue.path.join('.') || 'handoff'}: ${issue.message}`);
  return { ok: false, error: `${HANDOFF_ENV} is invalid (${problems.join('; ')}).` };
}
