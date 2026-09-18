import React, { useEffect, useRef, useState } from 'react';
import { spawn, type ChildProcess } from 'node:child_process';
import { Box, Text, useApp, useInput } from 'ink';
import { checkForUpgrade, type UpgradeCheckResult } from '../services/version-check.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CONTENTFUL_SCOPED_REGISTRY = 'https://npm.pkg.github.com';

type InstallResult = {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function spawnInstall(latest: string): { child: ChildProcess; donePromise: Promise<InstallResult> } {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCommand, [
    'install',
    '-g',
    `@contentful/experience-design-system-cli-v2@${latest}`,
    `--@contentful:registry=${CONTENTFUL_SCOPED_REGISTRY}`,
  ]);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdout += String(d);
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderr += String(d);
  });
  const donePromise = new Promise<InstallResult>((resolve) => {
    child.on('close', (code, signal) => {
      resolve({ exitCode: signal ? 1 : (code ?? 0), signal: signal ?? null, stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ exitCode: 1, signal: null, stdout, stderr: stderr + (err.message ?? String(err)) });
    });
  });
  return { child, donePromise };
}

function Spinner(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, []);
  return <Text color="cyan">{SPINNER_FRAMES[frame]}</Text>;
}

type Phase = 'checking' | 'up-to-date' | 'source-checkout' | 'upgrading' | 'done' | 'error';

export function UpgradeExecutionScreen({ onDone }: { onDone: () => void }): React.ReactElement {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('checking');
  const [current, setCurrent] = useState('');
  const [latest, setLatest] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const restarting = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void checkForUpgrade().then((result: UpgradeCheckResult) => {
      if (cancelled) {
        return;
      }

      if (result.status === 'error') {
        setErrorMessage("Couldn't check for updates — check your network connection.");
        setPhase('error');
        return;
      }

      setCurrent(result.current);

      if (result.status === 'up-to-date') {
        setPhase('up-to-date');
        return;
      }

      if (result.status === 'source-checkout') {
        setPhase('source-checkout');
        return;
      }

      setLatest(result.latest);
      setPhase('upgrading');

      const { donePromise } = spawnInstall(result.latest);
      void donePromise.then((installResult) => {
        if (cancelled) {
          return;
        }
        if (installResult.exitCode === 0) {
          setPhase('done');
        } else {
          setErrorMessage(
            installResult.stderr.trim() || 'Upgrade failed — you may need to re-authenticate with GitHub Packages.',
          );
          setPhase('error');
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useInput((input, key) => {
    if (phase === 'checking' || phase === 'upgrading') {
      return;
    }
    if (input === 'q') {
      exit();
      return;
    }
    if (phase === 'done') {
      if (input === 'r' && !restarting.current) {
        restarting.current = true;
        spawn(process.argv[0]!, process.argv.slice(1), { stdio: 'inherit', detached: true });
        process.exit(0);
      }
      return;
    }
    if (key.return || input === 'b') {
      onDone();
      return;
    }
  });

  if (phase === 'checking') {
    return (
      <Box gap={1}>
        <Spinner />
        <Text dimColor>Checking for updates...</Text>
      </Box>
    );
  }

  if (phase === 'upgrading') {
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Spinner />
          <Text>Upgrading to v{latest}...</Text>
        </Box>
        <Text dimColor>Running npm install -g @contentful/experience-design-system-cli-v2@{latest}</Text>
      </Box>
    );
  }

  if (phase === 'up-to-date') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>You're already on the latest version (v{current}).</Text>
        <Text dimColor>[Enter/B] Back to Start [Q] Quit</Text>
      </Box>
    );
  }

  if (phase === 'source-checkout') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>Running from a source checkout (v{current}) — use `git pull` to update instead.</Text>
        <Text dimColor>[Enter/B] Back to Start [Q] Quit</Text>
      </Box>
    );
  }

  if (phase === 'error') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">✖ {errorMessage}</Text>
        <Text dimColor>[Enter/B] Back to Start [Q] Quit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text color="green">✔ Upgrade complete — now on v{latest}</Text>
      <Text dimColor>[R] Restart now [Q] Quit</Text>
    </Box>
  );
}
