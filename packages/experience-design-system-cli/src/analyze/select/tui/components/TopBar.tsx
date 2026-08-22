import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { Box, Text } from 'ink';
import { findPkgRoot } from '../../../../lib/cli-path.js';

// Read via findPkgRoot() rather than a hardcoded-depth require — this file's
// depth under dist/ changes once the CLI is bundled into a single dist/src/index.js.
const VERSION: string = (JSON.parse(readFileSync(join(findPkgRoot(), 'package.json'), 'utf8')) as { version: string })
  .version;

type TopBarProps = {
  subcommand: string;
  hints: Array<{ key: string; label: string }>;
};

export function TopBar({ subcommand, hints }: TopBarProps): React.ReactElement {
  return (
    <Box justifyContent="space-between">
      <Text bold>{'experience-design-system-cli  ' + subcommand}</Text>
      <Text dimColor>
        {hints.map((h) => `[${h.key}] ${h.label}`).join('  ')}
        {'  v' + VERSION}
      </Text>
    </Box>
  );
}
