#!/usr/bin/env node
process.stdout.write('<<<EDS_OUTPUT_START>>>\n');
process.stdout.write(JSON.stringify([{ '$type': 'component' }]) + '\n');
process.stdout.write('<<<EDS_OUTPUT_END>>>\n');
process.exit(0);
