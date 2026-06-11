import { createRequire } from 'node:module';
import React from 'react';
import { Box, Text } from 'ink';

const require = createRequire(import.meta.url);
const pkg = require('../../../../../package.json') as { version: string };

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
        {'  v' + pkg.version}
      </Text>
    </Box>
  );
}
