#!/usr/bin/env node
// Emits a map_token_prop call targeting `label`, a content-category prop — not a design token prop
process.stdout.write(
  '{"tool":"map_token_prop","component":"Card","prop":"label","token_allowed":["colors.surface.default"],"description":"Mistaken target"}\n',
);
process.exit(0);
