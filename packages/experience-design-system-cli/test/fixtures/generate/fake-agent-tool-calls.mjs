#!/usr/bin/env node
// Emits tool-call lines for a Button component with one prop and one slot
process.stdout.write('Starting Button classification\n');
process.stdout.write('{"tool":"classify_component","description":"A test button component"}\n');
process.stdout.write('label is a required content prop\n');
process.stdout.write('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Button label"}\n');
process.stdout.write('{"tool":"classify_slot","slot":"icon","required":false,"description":"Optional icon"}\n');
process.exit(0);
