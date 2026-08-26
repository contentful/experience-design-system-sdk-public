#!/usr/bin/env node
// Emits a valid map_token_prop call for Card.bgColor, restricted to a known subset
process.stdout.write('bgColor is a background color token prop\n');
process.stdout.write(
  '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_sets":["default","raised"],"token_allowed":["default"],"description":"Background surface color"}\n',
);
process.exit(0);
