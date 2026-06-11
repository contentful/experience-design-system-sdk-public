import { createRequire } from 'node:module';
import React from 'react';
import { Box, Text } from 'ink';

// createRequire is needed because this is an ESM package — require() doesn't
// exist natively, but it's the simplest way to read a JSON file at runtime.
const _require = createRequire(import.meta.url);
const VERSION: string = (_require('../../../../../package.json') as { version: string }).version;

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
