// What the debug log says about the Token review: which token file was shown, how many tokens it had (or why it could not
// be read), and what the user did next.

export type TokenReviewOutcome = 'continued' | 'back';

/** The log's two sections: `summary` for a person, `data` for AI, both carrying the same facts. */
export function tokenReviewLog({
  tokensPath,
  tokenCount,
  loadError,
  outcome,
}: {
  tokensPath: string;
  /** How many tokens were shown. Ignored when the file could not be read. */
  tokenCount: number;
  /** Why the file could not be read, when it could not. */
  loadError: string | undefined;
  outcome: TokenReviewOutcome;
}): { summary: string[]; data: Record<string, unknown> } {
  const summary = [
    `Token file: ${tokensPath}`,
    loadError === undefined ? `Tokens shown: ${tokenCount}` : `Could not read the tokens: ${loadError}`,
    `Outcome: ${outcome === 'continued' ? 'continued' : 'went back'}`,
  ];

  return {
    summary,
    data: {
      tokens_path: tokensPath,
      ...(loadError === undefined ? { tokens: tokenCount } : { load_error: loadError }),
      outcome,
    },
  };
}
