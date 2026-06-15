import React, { useState } from 'react';
import { Box, Text, useStdout } from 'ink';
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
    /**
     * Error-severity validation messages. Components with any errors will be
     * auto-rejected by the next step (`analyze select --select-all`), so the
     * extract TUI surfaces them prominently — both with a per-row ✗ badge
     * and a dedicated Errors section below the component list.
     */
    errors: string[];
    extractionConfidence: number | null;
    needsReview: boolean;
  }>;
  totalWarnings: number;
  totalErrors: number;
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
  const { stdout } = useStdout();
  // Header lines: TopBar(1) + summary(3) + blank(1) + dividers+header(3) + blank(1) + footer(1) + footer-bar(1) = ~12
  const HEADER_ROWS = 12;
  const terminalRows = stdout?.rows ?? 24;
  const visibleCount = Math.max(1, terminalRows - HEADER_ROWS);
  const maxOffset = Math.max(0, result.components.length - visibleCount);

  useImmediateInput((input, key) => {
    if (input === 'q' || key.return) {
      onExit();
      return;
    }
    if (key.upArrow || input === 'k') {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow || input === 'j') {
      setScrollOffset((o) => Math.min(maxOffset, o + 1));
    } else if (input === 'g') {
      setScrollOffset(0);
    } else if (input === 'G') {
      setScrollOffset(maxOffset);
    }
  });

  const visible = result.components.slice(scrollOffset, scrollOffset + visibleCount);
  const showScrollUp = scrollOffset > 0;
  const showScrollDown = scrollOffset + visibleCount < result.components.length;

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
        <Text bold>
          {'Components' +
            (showScrollUp || showScrollDown
              ? '  (' +
                (scrollOffset + 1) +
                '–' +
                Math.min(scrollOffset + visibleCount, result.components.length) +
                ' of ' +
                result.components.length +
                ')'
              : '')}
        </Text>
        <Text dimColor>{'─'.repeat(70)}</Text>
        <Text> </Text>
        {showScrollUp && <Text dimColor> ▲ scroll up</Text>}
        {visible.map((component) => {
          const conf = component.extractionConfidence;
          const confColor =
            conf === null ? 'gray' : component.needsReview ? 'red' : conf >= 4 ? 'white' : conf >= 3 ? 'yellow' : 'red';
          const confLabel = conf === null ? '—' : (component.needsReview ? '⚑ ' : '') + String(conf);
          return (
            <Box key={component.name}>
              {component.errors.length > 0 && <Text color="red">✗ </Text>}
              {component.errors.length === 0 && component.warnings.length > 0 && <Text color="yellow">⚠ </Text>}
              {component.errors.length === 0 && component.warnings.length === 0 && <Text> </Text>}
              <Text>{truncateName(component.name).padEnd(20)}</Text>
              <Text dimColor>{component.framework.padEnd(10)}</Text>
              <Text>{(component.propCount + ' props').padEnd(10)}</Text>
              <Text>{(component.slotCount + ' ' + (component.slotCount === 1 ? 'slot' : 'slots')).padEnd(8)}</Text>
              <Text color={confColor}>{confLabel}</Text>
              {component.errors.length > 0 && (
                <Text color="red">
                  {'  ✗ ' + component.errors.length + ' error' + (component.errors.length === 1 ? '' : 's')}
                </Text>
              )}
              {component.errors.length === 0 && component.warnings.length > 0 && (
                <Text color="yellow">
                  {'  ⚠ ' + component.warnings.length + ' warning' + (component.warnings.length === 1 ? '' : 's')}
                </Text>
              )}
            </Box>
          );
        })}
        {showScrollDown && <Text dimColor> ▼ scroll down</Text>}
        {result.totalErrors > 0 && (
          <>
            <Text> </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text bold color="red">
              {'Errors (' + result.totalErrors + ')'}
            </Text>
            <Text dimColor>{'─'.repeat(70)}</Text>
            <Text> </Text>
            {result.components
              .filter((c) => c.errors.length > 0)
              .flatMap((c) => c.errors.map((e) => ({ component: c.name, error: e })))
              .map((e, i) => (
                <Text key={i} color="red">
                  {'  ✗ ' + e.component + ': ' + e.error}
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
