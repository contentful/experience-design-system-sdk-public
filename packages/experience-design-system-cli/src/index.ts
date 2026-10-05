import { readExperiencesCredentials } from './credentials-store.js';

// Color libraries read NO_COLOR once, when they first load, and program.js pulls
// them in through its static imports. So the stored preference has to reach the
// environment before program.js loads. It also carries to spawned subcommands,
// and an operator who exports NO_COLOR themselves still wins.
const { noColor } = await readExperiencesCredentials();
if (noColor && process.env['NO_COLOR'] === undefined) process.env['NO_COLOR'] = '1';

const { createProgram } = await import('./program.js');
const { failActiveCommand, flushAnalytics } = await import('./analytics/index.js');

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
