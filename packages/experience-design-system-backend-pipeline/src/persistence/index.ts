// TODO (INTEG-4979): move session/ from cli-legacy into this domain.
// This domain owns: SQLite sessions, caching (extraction, composition, selection,
// generation), source-file collection, and all persistence entry points.
//
// Entry points to implement:
//   openSession(), collectFiles(), getCandidateFiles(),
//   cacheExtraction(), cacheComposition(), persistComponents(),
//   persistSelection(), persistGeneration()

export {};
