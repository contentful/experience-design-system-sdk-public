import { createProgram } from './program.js';
import { migrateOldConfig } from './src/config/migrate.js';

await migrateOldConfig();

createProgram()
  .parseAsync()
  .catch((err) => {
    process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
