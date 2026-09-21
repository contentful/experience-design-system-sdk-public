import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { FOCUS_MARKER, PALETTE } from '../home/home.theme.js';
import { checkForUpgrade, isSourceCheckout, type UpgradeCheckResult } from './version.js';

const GLOBAL_INSTALL_COMMANDS = [
  'npm install -g @contentful/experience-design-system-cli-v2@latest --@contentful:registry=https://npm.pkg.github.com',
];
const SOURCE_CHECKOUT_COMMANDS = [
  'git pull origin main',
  'pnpm install',
  'pnpm -F @contentful/experience-design-system-cli-v2 build',
];

export function UpgradeScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const [upgradeCheck, setUpgradeCheck] = useState<UpgradeCheckResult>();

  useEffect(() => {
    checkForUpgrade()
      .then(setUpgradeCheck)
      .catch(() => setUpgradeCheck({ status: 'error' }));
  }, []);

  useInput((_input, key) => {
    if (key.return) {
      onDone();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Upgrade</Text>
      <Text> </Text>
      {renderBody(upgradeCheck)}
      <Text> </Text>
      <Text bold color={PALETTE.accent}>
        {FOCUS_MARKER} Go Back
      </Text>
    </Box>
  );
}

function renderBody(upgradeCheck: UpgradeCheckResult | undefined): React.ReactElement {
  if (!upgradeCheck) {
    return <Text color={PALETTE.muted}>Checking for updates…</Text>;
  }

  if (upgradeCheck.status === 'error') {
    return (
      <Text color={PALETTE.warning}>Couldn't check for updates — check your network connection and try again.</Text>
    );
  }

  if (upgradeCheck.status === 'up-to-date') {
    return <Text color={PALETTE.success}>You're already on the latest version (v{upgradeCheck.current}).</Text>;
  }

  const commands = isSourceCheckout() ? SOURCE_CHECKOUT_COMMANDS : GLOBAL_INSTALL_COMMANDS;

  return (
    <Box flexDirection="column">
      <Text color={PALETTE.muted}>
        <Text bold color={PALETTE.success}>
          v{upgradeCheck.latest}
        </Text>{' '}
        is available (you're on <Text bold>v{upgradeCheck.current}</Text>). Exit this program and run the following to
        upgrade:
      </Text>
      <Text> </Text>
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.border} paddingX={1}>
        {commands.map((cmd) => (
          <Text bold key={cmd}>
            {cmd}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
