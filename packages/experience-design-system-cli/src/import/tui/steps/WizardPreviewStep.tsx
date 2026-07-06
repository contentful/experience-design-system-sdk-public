import React, { useState, useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import type { ServerPreviewResponse, DesignTokenSummary } from '@contentful/experience-design-system-types';
import { hasBreakingChangesWithImpact } from '../../../apply/manifest.js';
import { computeComponentDiffLines } from './preview-diff.js';

export interface PreviewDiffLine {
  key: string;
  color: 'green' | 'red' | 'yellow' | 'gray';
  text: string;
}

/**
 * Pure builder for the wizard preview diff lines. Extracted from the render
 * layer so it can be unit-tested independently of Ink.
 */
export function buildPreviewDiffLines(preview: ServerPreviewResponse): PreviewDiffLine[] {
  const lines: PreviewDiffLine[] = [];
  const { components, tokens } = preview;

  for (const item of components.new) {
    const raw = item as unknown as Record<string, unknown>;
    const name = (raw.key as string) ?? (raw.$name as string) ?? 'unknown';
    lines.push({ key: `comp-new-${name}`, color: 'green', text: ` + ${name}` });
    const slots = (raw.$slots ?? {}) as Record<string, Record<string, unknown>>;
    for (const slotName of Object.keys(slots).sort()) {
      lines.push({
        key: `comp-new-${name}-slot-${slotName}`,
        color: 'green',
        text: `   slot: ${slotName}`,
      });
      const allowed = slots[slotName]?.['$allowedComponents'];
      if (Array.isArray(allowed) && allowed.length > 0) {
        const names = (allowed as unknown[]).filter((n): n is string => typeof n === 'string');
        lines.push({
          key: `comp-new-${name}-slot-${slotName}-allow`,
          color: 'green',
          text: `     allowedComponents: [${names.join(', ')}]`,
        });
      }
    }
  }

  for (const item of components.removed) {
    lines.push({ key: `comp-rm-${item.name}`, color: 'red', text: ` - ${item.name}` });
  }

  for (const item of components.changed) {
    lines.push({
      key: `comp-h-${item.current.name}`,
      color: 'yellow',
      text: ` ~ ${item.current.name}${item.hasPendingDraftChanges ? ' ⚡ has pending draft changes' : ''}`,
    });
    if (item.changeClassification?.classification === 'breaking') {
      const reasons = item.changeClassification.breakingChanges
        .map((bc) => `${bc.propertyId}: ${bc.reason}`)
        .join(', ');
      lines.push({ key: `comp-b-${item.current.name}`, color: 'red', text: ` ⚠ BREAKING: ${reasons}` });
    }
    const diffLines = computeComponentDiffLines(
      item.current,
      item.proposed as unknown as Record<string, unknown>,
      item.changeClassification,
    );
    for (const d of diffLines) {
      lines.push({ key: `comp-d-${item.current.name}-${d.key}`, color: d.color, text: ` ${d.text}` });
    }
    // Also enumerate slots + allowedComponents from the proposed side so the
    // reviewer sees the shape they're pushing, not just the delta.
    const proposedSlots =
      ((item.proposed as unknown as Record<string, unknown>)['$slots'] as
        | Record<string, Record<string, unknown>>
        | undefined) ?? {};
    for (const slotName of Object.keys(proposedSlots).sort()) {
      const allowed = proposedSlots[slotName]?.['$allowedComponents'];
      if (Array.isArray(allowed) && allowed.length > 0) {
        const names = (allowed as unknown[]).filter((n): n is string => typeof n === 'string');
        const key = `comp-d-${item.current.name}-slot-${slotName}-allow-list`;
        if (!lines.some((l) => l.key === key)) {
          lines.push({
            key,
            color: 'gray',
            text: `   slot ${slotName} allowedComponents: [${names.join(', ')}]`,
          });
        }
      }
    }
  }

  for (const item of tokens.new) {
    const raw = item as unknown as Record<string, unknown>;
    const name = (raw.name as string) ?? (raw.path as string) ?? 'unknown';
    lines.push({ key: `tok-new-${name}`, color: 'green', text: ` + ${name}` });
  }
  for (const item of tokens.removed) {
    lines.push({ key: `tok-rm-${item.name}`, color: 'red', text: ` - ${item.name}` });
  }
  for (const item of tokens.changed) {
    const tokenName = (item.current as DesignTokenSummary).name;
    lines.push({
      key: `tok-h-${tokenName}`,
      color: 'yellow',
      text: ` ~ ${tokenName}${item.hasPendingDraftChanges ? ' ⚡ has pending draft changes' : ''}`,
    });
    if (item.changeClassification?.classification === 'breaking') {
      const reasons = item.changeClassification.breakingChanges
        .map((bc) => `${bc.propertyId}: ${bc.reason}`)
        .join(', ');
      lines.push({ key: `tok-b-${tokenName}`, color: 'red', text: ` ⚠ BREAKING: ${reasons}` });
    }
  }

  return lines;
}

type WizardPreviewStepProps = {
  preview: ServerPreviewResponse;
  spaceId: string;
  environmentId: string;
  stepNumber: number;
  totalSteps: number;
  onConfirm: (acknowledge: boolean) => void;
  onEdit?: () => void;
  onSaveFiles?: () => void;
  onQuit: () => void;
};

export function WizardPreviewStep({
  preview,
  spaceId,
  environmentId,
  stepNumber,
  totalSteps,
  onConfirm,
  onEdit,
  onSaveFiles,
  onQuit,
}: WizardPreviewStepProps): React.ReactElement {
  const breakingWithImpact = hasBreakingChangesWithImpact(preview);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 40;
  const viewportHeight = Math.max(terminalRows - 14, 10);

  const allDiffLines = useMemo(() => {
    if (!diffExpanded) return [];
    return buildPreviewDiffLines(preview).map((line) => ({
      key: line.key,
      element: <Text color={line.color === 'gray' ? undefined : line.color} dimColor={line.color === 'gray'}>{line.text}</Text>,
    }));
  }, [diffExpanded, preview]);

  const maxScroll = Math.max(0, allDiffLines.length - viewportHeight);

  useImmediateInput((input, key) => {
    if (key.return) {
      onConfirm(breakingWithImpact);
      return;
    }
    if (input === 'd' || input === 'D') {
      setDiffExpanded((prev) => !prev);
      setScrollOffset(0);
      return;
    }
    if (diffExpanded) {
      if (input === 'j' || key.downArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxScroll));
        return;
      }
      if (input === 'k' || key.upArrow) {
        setScrollOffset((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (input === 'f') {
        setScrollOffset((prev) => Math.min(prev + viewportHeight, maxScroll));
        return;
      }
      if (input === 'b') {
        setScrollOffset((prev) => Math.max(prev - viewportHeight, 0));
        return;
      }
    }
    if ((input === 'e' || input === 'E') && onEdit) {
      onEdit();
      return;
    }
    if (input === 's' && onSaveFiles) {
      onSaveFiles();
      return;
    }
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  const { components, tokens } = preview;
  const hasComponents = components.new.length + components.changed.length + components.removed.length > 0;
  const hasTokens = tokens.new.length + tokens.changed.length + tokens.removed.length > 0;
  const hasAnything = hasComponents || hasTokens;

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={1}>
      <Box flexDirection="column" gap={0}>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box gap={1}>
          <Text bold>
            Step {stepNumber} of {totalSteps}
          </Text>
          <Text bold>—</Text>
          <Text bold>Push to Contentful</Text>
        </Box>
        <Text dimColor>{'─'.repeat(40)}</Text>
      </Box>

      {hasAnything ? (
        <>
          <Text>Here&apos;s what will happen in your space:</Text>

          {hasComponents && (
            <Box flexDirection="column" gap={0}>
              <Box gap={1} marginTop={1}>
                <Text bold dimColor>
                  ComponentTypes
                </Text>
              </Box>
              {components.new.length > 0 && (
                <Box flexDirection="column">
                  <Box gap={1}>
                    <Text color="green"> ＋</Text>
                    <Text>{components.new.length} will be created</Text>
                  </Box>
                  {(components.new as unknown as Array<Record<string, unknown>>).map((item, i) => {
                    const name = (item.key as string) ?? (item.$name as string) ?? 'unknown';
                    return (
                      <Text key={`new-${i}`} color="green">
                        {' '}
                        + {name}
                      </Text>
                    );
                  })}
                </Box>
              )}
              {components.changed.length > 0 && (
                <Box flexDirection="column">
                  <Box gap={1}>
                    <Text color="yellow"> ～</Text>
                    <Text>{components.changed.length} will be updated</Text>
                  </Box>
                  {components.changed.map((item, i) => {
                    const isBreaking = item.changeClassification?.classification === 'breaking';
                    return (
                      <Text key={`chg-${i}`} color={isBreaking ? 'red' : 'yellow'}>
                        {' '}
                        {isBreaking ? '⚠' : '~'} {item.current.name}
                      </Text>
                    );
                  })}
                </Box>
              )}
              {components.removed.length > 0 && (
                <Box flexDirection="column">
                  <Box gap={1}>
                    <Text color="red"> ✗</Text>
                    <Text>{components.removed.length} will be removed</Text>
                  </Box>
                  {components.removed.map((item, i) => (
                    <Text key={`rm-${i}`} color="red">
                      {' '}
                      ✗ {item.name}
                    </Text>
                  ))}
                </Box>
              )}
              {components.unchanged.length > 0 && (
                <Box gap={1}>
                  <Text dimColor> ·</Text>
                  <Text dimColor>{components.unchanged.length} unchanged</Text>
                </Box>
              )}
            </Box>
          )}

          {hasTokens && (
            <Box flexDirection="column" gap={0}>
              <Box gap={1} marginTop={1}>
                <Text bold dimColor>
                  Design Tokens
                </Text>
              </Box>
              {tokens.new.length > 0 && (
                <Box gap={1}>
                  <Text color="green"> ＋</Text>
                  <Text>{tokens.new.length} will be created</Text>
                </Box>
              )}
              {tokens.changed.length > 0 && (
                <Box gap={1}>
                  <Text color="yellow"> ～</Text>
                  <Text>{tokens.changed.length} will be updated</Text>
                </Box>
              )}
              {tokens.removed.length > 0 && (
                <Box gap={1}>
                  <Text color="red"> ✗</Text>
                  <Text>{tokens.removed.length} will be removed</Text>
                </Box>
              )}
              {tokens.unchanged.length > 0 && (
                <Box gap={1}>
                  <Text dimColor> ·</Text>
                  <Text dimColor>{tokens.unchanged.length} unchanged</Text>
                </Box>
              )}
            </Box>
          )}

          {diffExpanded && allDiffLines.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>{'─'.repeat(40)}</Text>
              <Text dimColor>
                {' '}
                Diff ({allDiffLines.length} lines) — line {scrollOffset + 1}–
                {Math.min(scrollOffset + viewportHeight, allDiffLines.length)} of {allDiffLines.length}
              </Text>
              <Box flexDirection="column">
                {allDiffLines.slice(scrollOffset, scrollOffset + viewportHeight).map((line) => (
                  <Box key={line.key}>{line.element}</Box>
                ))}
              </Box>
              {maxScroll > 0 && <Text dimColor> ↕ j/k to scroll, f/b to page</Text>}
            </Box>
          )}
        </>
      ) : (
        <Text dimColor>Nothing to push — everything is already up to date.</Text>
      )}

      <Box gap={1} marginTop={1}>
        <Text dimColor>Space:</Text>
        <Text>{spaceId}</Text>
        <Text dimColor>/</Text>
        <Text dimColor>Environment:</Text>
        <Text>{environmentId}</Text>
      </Box>

      {breakingWithImpact && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ⚠ Breaking changes will affect downstream entities. Press Enter to acknowledge and apply.
          </Text>
        </Box>
      )}

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Push to Contentful</Text>
        <Text dimColor>[d] {diffExpanded ? 'Hide' : 'Show'} diff</Text>
        {diffExpanded && <Text dimColor>[j/k] Scroll [f/b] Page</Text>}
        {onEdit && <Text dimColor>[e] Edit definitions</Text>}
        {onSaveFiles && <Text dimColor>[s] Save files instead</Text>}
        <Text dimColor>[q] Cancel</Text>
      </Box>
    </Box>
  );
}
