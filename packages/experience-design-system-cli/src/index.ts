import { createProgram } from './program.js';
import { failActiveCommand } from './analytics/index.js';

createProgram()
  .parseAsync()
  .catch(async (err) => {
    await failActiveCommand({
      error_name: err instanceof Error ? err.name : 'Error',
    });
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
