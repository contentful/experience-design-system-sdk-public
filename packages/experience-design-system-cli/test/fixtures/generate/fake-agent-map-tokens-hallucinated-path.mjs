#!/usr/bin/env node
// Emits a map_token_prop call with one real token path and one invented (hallucinated) path
process.stdout.write(
  '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_sets":["colors.surface.default","colors.invented.path"],"description":"Background surface color"}\n',
);
process.exit(0);
