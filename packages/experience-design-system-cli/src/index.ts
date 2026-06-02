import { createProgram } from './program.js';

createProgram().parseAsync().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
