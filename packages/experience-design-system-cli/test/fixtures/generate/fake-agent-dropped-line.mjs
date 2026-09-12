#!/usr/bin/env node
// Emits one valid classify_prop line and one line that never closes its JSON
// object — simulating a truncated tool-call the parser can't recover, on every
// invocation (so the retry attempt sees the same failure and the component
// ends up recorded as failed rather than silently shipped with a missing prop).
process.stdout.write('{"tool":"classify_component","description":"A button component"}\n');
process.stdout.write('{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","required":true,"description":"Button label"}\n');
process.stdout.write('{"tool":"classify_prop","prop":"variant","cdf_type":"enum","cdf_category":"design"\n');
process.exit(0);
