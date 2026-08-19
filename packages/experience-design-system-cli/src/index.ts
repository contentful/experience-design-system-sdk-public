import { createProgram } from './program.js';
import { failActiveCommand, flushAnalytics } from './analytics/index.js';

createProgram()
  .parseAsync()
  .catch(async (err) => {
    await failActiveCommand({
      error_name: err instanceof Error ? err.name : 'Error',
    });
    await flushAnalytics();
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
