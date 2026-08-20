#!/usr/bin/env node
// Emits a map_token_prop call where token_allowed is not a subset of token_sets
process.stdout.write(
  '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_sets":["colors.surface.default"],"token_allowed":["colors.brand.primary"],"description":"Background surface color"}\n',
);
process.exit(0);
