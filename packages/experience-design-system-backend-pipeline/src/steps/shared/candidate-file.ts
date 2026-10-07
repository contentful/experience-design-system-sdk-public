/**
 * A source file surfaced into an agent prompt as composition evidence.
 * Produced by persistence/collect-files; consumed by step-2 (composition).
 */
export type CandidateFile = { path: string; content: string };
