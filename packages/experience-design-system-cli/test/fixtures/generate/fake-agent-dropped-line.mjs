#!/usr/bin/env node
// Always emits one valid line plus one that never closes its JSON object,
// so every retry sees the same truncated-tool-call failure.
process.stdout.write('{"tool":"classify_component","description":"A button component"}\n');
process.stdout.write('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Button label"}\n');
process.stdout.write('{"tool":"classify_prop","prop":"variant","cdf_type":"enum","cdf_category":"design"\n');
process.exit(0);
