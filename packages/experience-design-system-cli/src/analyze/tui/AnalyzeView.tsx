import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TopBar } from '../select/tui/components/TopBar.js';
import { useImmediateInput } from '../select/tui/hooks/useImmediateInput.js';

export type AnalyzeViewResult = {
  sourceDirectory: string;
  sessionId: string;
  fileCount: number;
  components: Array<{
    name: string;
    framework: 'react' | 'next' | 'vue' | 'astro' | 'web-component' | 'stencil';
    propCount: number;
    slotCount: number;
    warnings: string[];
  }>;
  totalWarnings: number;
  zeroPropComponents?: Array<{ name: string; source: string }>;
};

type AnalyzeViewProps = {
  result: AnalyzeViewResult;
  onExit: () => void;
};

function truncateName(name: string, maxLen = 30): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

export function AnalyzeView({ result, onExit }: AnalyzeViewProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);

  useImmediateInput((input, key) => {
    if (input === 'q' || key.return) {
      onExit();
      return;
    }
    if (key.upArrow || input === 'k') {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow || input === 'j') {
      setScrollOffset((o) => o + 1);
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(Math.max(0, result.components.length + 10));
    }
  });

  return (
    <Box flexDirection="column">
      <TopBar
        subcommand="analyze"
        hints={[
          { key: '?', label: 'help' },
          { key: 'q', label: 'quit' },
        ]}
      />
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>{'Scanned ' + result.fileCount + ' source files in ' + result.sourceDirectory}</Text>
        <Text>{'Extracted ' + result.components.length + ' components'}</Text>
        <Text dimColor>{'Session: ' + result.sessionId}</Text>
        <Text> </Text>
        <Text dimColor>{'─'.repeat(70)}</Text>
        <Text bold>Components</Text>
        <Text dimColor>{'─'.repeat(70)}</Text>
        <Text> </Text>
        {result.components.slice(scrollOffset).map((component) => (
          <Box key={component.name}>
            {component.warnings.length > 0 && <Text color="yellow">⚠ </Text>}
            {component.warnings.length === 0 && <Text> </Text>}
            <Text>{truncateName(component.name).padEnd(20)}</Text>
            <Text dimColor>{component.framework.padEnd(10)}</Text>
            <Text>{(component.propCount + ' props').padEnd(10)}</Text>
            <Text>{component.slotCount + ' ' + (component.slotCount === 1 ? 'slot' : 'slots')}</Text>
            {component.warnings.length > 0 && (
              <Text color="yellow">
                {'  ' + component.warnings.length + ' warning' + (component.warnings.length === 1 ? '' : 's')}
              </Text>
            )}
          </Box>
        ))}
        {result.zeroPropComponents && result.zeroPropComponents.length > 0 && (
          <>
            <Text> </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text bold color="yellow">
              {'Zero-prop components (' + result.zeroPropComponents.length + ')'}
            </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text color="yellow">{'  These may be Storybook stories, context providers, or SSR utilities.'}</Text>
            <Text color="yellow">{'  Review them in `analyze select` before generating.'}</Text>
            <Text> </Text>
            {result.zeroPropComponents.map((c) => (
              <Text key={c.name} color="yellow">
                {'  ' + c.name + ' (' + c.source + ')'}
              </Text>
            ))}
          </>
        )}
        {result.totalWarnings > 0 && (
          <>
            <Text> </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text bold color="yellow">
              {'Warnings (' + result.totalWarnings + ')'}
            </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text> </Text>
            {result.components
              .filter((c) => c.warnings.length > 0)
              .flatMap((c) => c.warnings.map((w) => ({ component: c.name, warning: w })))
              .map((w, i) => (
                <Text key={i} color="yellow">
                  {'  ⚠ ' + w.component + ': ' + w.warning}
                </Text>
              ))}
          </>
        )}
        <Text> </Text>
        <Text dimColor>{'Run: analyze select --session ' + result.sessionId}</Text>
        <Text> </Text>
      </Box>
      <Box borderStyle="single" paddingX={1}>
        <Text dimColor>Press Enter or q to exit</Text>
      </Box>
    </Box>
  );
}
