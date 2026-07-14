import React, { useState, useEffect } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type FileCounts = {
  tsx: number;
  ts: number;
  vue: number;
  astro: number;
  jsx: number;
  js: number;
  json: number;
  other: number;
  total: number;
};

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  'storybook-static',
  'out',
  '.git',
]);

async function countFiles(dir: string): Promise<FileCounts> {
  const counts: FileCounts = {
    tsx: 0,
    ts: 0,
    vue: 0,
    astro: 0,
    jsx: 0,
    js: 0,
    json: 0,
    other: 0,
    total: 0,
  };

  async function walk(current: string) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (IGNORE_DIRS.has(entry)) return;
        const full = join(current, entry);
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          return;
        }
        if (stat.isDirectory()) {
          await walk(full);
        } else {
          counts.total++;
          const ext = entry.slice(entry.lastIndexOf('.'));
          if (ext === '.tsx') counts.tsx++;
          else if (ext === '.ts' && !entry.endsWith('.d.ts')) counts.ts++;
          else if (ext === '.vue') counts.vue++;
          else if (ext === '.astro') counts.astro++;
          else if (ext === '.jsx') counts.jsx++;
          else if (ext === '.js') counts.js++;
          else if (ext === '.json') counts.json++;
          else counts.other++;
        }
      }),
    );
  }

  await walk(dir);
  return counts;
}

type PathValidationStepProps = {
  projectPath: string;
  onConfirm: (projectPath: string) => void;
  onSkipComponents: () => void;
  onChangePath: () => void;
  onQuit: () => void;
};

export function PathValidationStep({
  projectPath,
  onConfirm,
  onSkipComponents,
  onChangePath,
  onQuit,
}: PathValidationStepProps): React.ReactElement {
  const [counts, setCounts] = useState<FileCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const stat = await fs.stat(projectPath);
        if (stat.isFile()) {
          setError(
            `That's a file, not a directory.\n\nProvide the path to your component library's root folder, not a specific file.\n\nExample: ~/projects/my-design-system`,
          );
          return;
        }
        if (!stat.isDirectory()) {
          setError(`Not a directory: ${projectPath}`);
          return;
        }
        const result = await countFiles(projectPath);
        setCounts(result);
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          setError(
            `Directory not found: ${projectPath}\n\nDouble-check the path and try again. Tip: you can use ~, relative, or absolute paths.`,
          );
        } else if (code === 'EACCES') {
          setError(`Permission denied: ${projectPath}\n\nYou don't have read access to this directory.`);
        } else {
          setError(`Cannot access: ${projectPath}`);
        }
      }
    })();
  }, [projectPath]);

  useImmediateInput((input, key) => {
    if (error) {
      if (input === 'e' || key.return) {
        onChangePath();
        return;
      }
      if (input === 'q' || key.escape) {
        onQuit();
        return;
      }
      return;
    }
    if (!counts) return;
    if (key.return) {
      onConfirm(projectPath);
      return;
    }
    if (input === 's') {
      onSkipComponents();
      return;
    }
    if (input === 'e') {
      onChangePath();
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  if (!counts && !error) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text dimColor>
          Scanning <Text bold>{projectPath}</Text>...
        </Text>
      </Box>
    );
  }

  if (error) {
    const lines = error.split('\n');
    return (
      <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
        <Box flexDirection="column">
          <Text color={PALETTE.error}>✗ {lines[0]}</Text>
          {lines.slice(1).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
        <Box gap={3} marginTop={1}>
          <Text dimColor>[e / Enter] Try a different path</Text>
          <Text dimColor>[q] Quit</Text>
        </Box>
      </Box>
    );
  }

  const c = counts!;
  const componentFiles = c.tsx + c.ts + c.vue + c.astro + c.jsx + c.js;
  const tokenFiles = c.json;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text>
        Scanning <Text bold>{projectPath}</Text>...
      </Text>

      <Box flexDirection="column" gap={0} marginTop={1}>
        <Text color={PALETTE.success}>✓ Found {c.total} files:</Text>
        {c.tsx > 0 && (
          <Text>
            {'  • '}
            {String(c.tsx).padStart(3)} .tsx files
          </Text>
        )}
        {c.ts > 0 && (
          <Text>
            {'  • '}
            {String(c.ts).padStart(3)} .ts files
          </Text>
        )}
        {c.vue > 0 && (
          <Text>
            {'  • '}
            {String(c.vue).padStart(3)} .vue files
          </Text>
        )}
        {c.astro > 0 && (
          <Text>
            {'  • '}
            {String(c.astro).padStart(3)} .astro files
          </Text>
        )}
        {c.jsx > 0 && (
          <Text>
            {'  • '}
            {String(c.jsx).padStart(3)} .jsx files
          </Text>
        )}
        {c.js > 0 && (
          <Text>
            {'  • '}
            {String(c.js).padStart(3)} .js files
          </Text>
        )}
        {c.json > 0 && (
          <Text color={PALETTE.info}>
            {'  • '}
            {String(c.json).padStart(3)} .json files (design tokens)
          </Text>
        )}
        {c.other > 0 && (
          <Text dimColor>
            {'  • '}
            {String(c.other).padStart(3)} other (ignored)
          </Text>
        )}
      </Box>

      {componentFiles === 0 && tokenFiles === 0 && (
        <Text color={PALETTE.warning}>⚠ No component or token files found. Try a different path.</Text>
      )}
      {componentFiles === 0 && tokenFiles > 0 && (
        <Text color={PALETTE.warning}>⚠ No component files found — only token files detected.</Text>
      )}

      <Box marginTop={1}>
        <Text>Does this look right?</Text>
      </Box>

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Yes, start extracting</Text>
        <Text dimColor>[s] Skip components</Text>
        <Text dimColor>[e] Change path</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
