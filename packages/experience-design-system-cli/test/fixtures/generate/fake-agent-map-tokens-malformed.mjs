#!/usr/bin/env node
// Emits one malformed JSON line followed by one valid map_token_prop call
process.stdout.write('{not valid json\n');
process.stdout.write(
  '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_sets":["colors.surface.default"],"description":"Background surface color"}\n',
);
process.exit(0);
