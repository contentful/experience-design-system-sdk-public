#!/usr/bin/env node
// Emits tool-call lines for a Button component matching the test's RAW_COMPONENTS fixture
process.stdout.write('{"tool":"classify_component","description":"A button component"}\n');
process.stdout.write('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Button label"}\n');
process.exit(0);
