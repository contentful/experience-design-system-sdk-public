import React, { useState, useEffect } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';

type WelcomeStepProps = {
  onContinue: (projectPath: string) => void;
  onQuit: () => void;
};

export function WelcomeStep({ onContinue, onQuit }: WelcomeStepProps): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(interval);
  }, []);

  useImmediateInput((input, key) => {
    if (key.return) {
      const trimmed = inputValue.trim();
      if (trimmed) onContinue(trimmed);
      return;
    }
    if (key.escape || input === 'q') {
      onQuit();
      return;
    }
    if (key.backspace || key.delete) {
      setInputValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      setInputValue((v) => v + input);
    }
  });

  const displayValue = inputValue + (cursorVisible ? '█' : ' ');

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Text bold color={PALETTE.success}>
        👋 Hey! Let&apos;s import your design system into Contentful.
      </Text>
      <Text dimColor>I&apos;ll walk you through 5 steps to get your components into Contentful ExO.</Text>

      <Box flexDirection="column" marginTop={1} gap={0}>
        <Text dimColor>────────────────────────────────────────</Text>
        <Box gap={1}>
          <Text bold>Step 1</Text>
          <Text dimColor>Extract components from your codebase</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Step 2</Text>
          <Text dimColor>Review what was extracted</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Step 3</Text>
          <Text dimColor>Generate CDF definitions with Claude</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Step 4</Text>
          <Text dimColor>Review generated definitions</Text>
        </Box>
        <Box gap={1}>
          <Text bold>Step 5</Text>
          <Text dimColor>Push to Contentful</Text>
        </Box>
        <Text dimColor>────────────────────────────────────────</Text>
      </Box>

      <Box flexDirection="column" marginTop={1} gap={0}>
        <Text>Where is your component library?</Text>
        <Box gap={1} marginTop={0}>
          <Text color={PALETTE.info}>?</Text>
          <Text>Project path:</Text>
          <Text>{displayValue}</Text>
        </Box>
      </Box>

      <Box marginTop={1} gap={3}>
        <Text dimColor>[Enter] Continue</Text>
        <Text dimColor>[q] Quit</Text>
      </Box>
    </Box>
  );
}
