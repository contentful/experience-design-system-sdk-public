import React, { useEffect, useState, useMemo } from 'react';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { Box, Text } from 'ink';
import { useImmediateInput } from '../../../analyze/select/tui/hooks/useImmediateInput.js';
import { useTerminalSize } from '../../../tui/use-terminal-size.js';
import type {
  ChangeClassification,
  ServerPreviewResponse,
  DesignTokenSummary,
} from '@contentful/experience-design-system-types';
import { hasBreakingChangesWithImpact } from '../../../apply/tokens.js';
import { computeComponentDiffLines } from './preview-diff.js';
import { StepHeader } from '../components/StepHeader.js';
import { SpaceEnvironment } from '../components/SpaceEnvironment.js';
import { usePreviewConfirmationInput } from '../preview-confirmation-input.js';
import { WindowedPanel, terminalPanelHeight } from '../../../tui/windowed-panel.js';

export interface PreviewDiffLine {
  key: string;
  color: string;
  text: string;
}

export function buildPreviewSummaryLines(preview: ServerPreviewResponse): PreviewDiffLine[] {
  const lines: PreviewDiffLine[] = [];
  const { components, tokens } = preview;

  if (components.new.length > 0) {
    lines.push({
      key: 'summary-components-new',
      color: PALETTE.success,
      text: ` ＋ ${components.new.length} will be created`,
    });
    for (const [index, item] of (components.new as unknown as Array<Record<string, unknown>>).entries()) {
      const name = (item.key as string) ?? (item.$name as string) ?? 'unknown';
      lines.push({ key: `summary-components-new-${index}`, color: PALETTE.success, text: `  + ${name}` });
    }
  }

  if (components.changed.length > 0) {
    lines.push({
      key: 'summary-components-changed',
      color: PALETTE.warning,
      text: ` ～ ${components.changed.length} will be updated`,
    });
    for (const [index, item] of components.changed.entries()) {
      const isBreaking = item.changeClassification?.classification === 'breaking';
      lines.push({
        key: `summary-components-changed-${index}`,
        color: isBreaking ? PALETTE.error : PALETTE.warning,
        text: ` ${isBreaking ? '⚠' : '~'} ${item.current.name}`,
      });
    }
  }

  if (components.removed.length > 0) {
    lines.push({
      key: 'summary-components-removed',
      color: PALETTE.warning,
      text: ` ⊘ ${components.removed.length} will be skipped`,
    });
    for (const [index, item] of components.removed.entries()) {
      lines.push({ key: `summary-components-removed-${index}`, color: PALETTE.warning, text: ` ⊘ ${item.name}` });
    }
  }

  if (components.unchanged.length > 0) {
    lines.push({
      key: 'summary-components-unchanged',
      color: 'gray',
      text: ` · ${components.unchanged.length} unchanged`,
    });
  }

  if (tokens.new.length > 0) {
    lines.push({
      key: 'summary-tokens-new',
      color: PALETTE.success,
      text: ` ＋ ${tokens.new.length} design tokens will be created`,
    });
  }
  if (tokens.changed.length > 0) {
    lines.push({
      key: 'summary-tokens-changed',
      color: PALETTE.warning,
      text: ` ～ ${tokens.changed.length} design tokens will be updated`,
    });
  }
  if (tokens.removed.length > 0) {
    lines.push({
      key: 'summary-tokens-removed',
      color: PALETTE.warning,
      text: ` ⊘ ${tokens.removed.length} design tokens will be skipped`,
    });
  }
  if (tokens.unchanged.length > 0) {
    lines.push({
      key: 'summary-tokens-unchanged',
      color: 'gray',
      text: ` · ${tokens.unchanged.length} design tokens unchanged`,
    });
  }

  return lines;
}

function formatPreviewScrollIndicator(totalLines: number, offset: number, viewportHeight: number): string {
  const maxScroll = Math.max(0, totalLines - viewportHeight);
  const above = offset > 0 ? `↑ ${offset} above` : '';
  const below = maxScroll > offset ? `↓ ${totalLines - offset - viewportHeight} below` : '';
  const parts = [above, below].filter(Boolean);
  return parts.length > 0 ? ` ${parts.join(' · ')}` : ' ';
}

function appendChangedPreviewLine(
  lines: PreviewDiffLine[],
  keyPrefix: string,
  name: string,
  hasPendingDraftChanges: boolean,
  changeClassification?: ChangeClassification,
): void {
  lines.push({
    key: `${keyPrefix}-h-${name}`,
    color: PALETTE.warning,
    text: ` ~ ${name}${hasPendingDraftChanges ? ' ⚡ has pending draft changes' : ''}`,
  });
  if (changeClassification?.classification !== 'breaking') return;

  const reasons = changeClassification.breakingChanges
    .map((bc) => `${'slotId' in bc ? bc.slotId : bc.propertyId}: ${bc.reason}`)
    .join(', ');
  lines.push({ key: `${keyPrefix}-b-${name}`, color: PALETTE.error, text: ` ⚠ BREAKING: ${reasons}` });
}

export function buildPreviewDiffLines(preview: ServerPreviewResponse): PreviewDiffLine[] {
  const lines: PreviewDiffLine[] = [];
  const { components, tokens } = preview;

  for (const item of components.new) {
    const raw = item as unknown as Record<string, unknown>;
    const name = (raw.key as string) ?? (raw.$name as string) ?? 'unknown';
    lines.push({ key: `comp-new-${name}`, color: PALETTE.success, text: ` + ${name}` });
    const slots = (raw.$slots ?? {}) as Record<string, Record<string, unknown>>;
    for (const slotName of Object.keys(slots).sort()) {
      lines.push({
        key: `comp-new-${name}-slot-${slotName}`,
        color: PALETTE.success,
        text: `   slot: ${slotName}`,
      });
      const allowed = slots[slotName]?.['$allowedComponents'];
      if (Array.isArray(allowed) && allowed.length > 0) {
        const names = (allowed as unknown[]).filter((n): n is string => typeof n === 'string');
        lines.push({
          key: `comp-new-${name}-slot-${slotName}-allow`,
          color: PALETTE.success,
          text: `     allowedComponents: [${names.join(', ')}]`,
        });
      }
    }
  }

  for (const item of components.removed) {
    lines.push({ key: `comp-rm-${item.name}`, color: PALETTE.error, text: ` - ${item.name}` });
  }

  for (const item of components.changed) {
    appendChangedPreviewLine(lines, 'comp', item.current.name, item.hasPendingDraftChanges, item.changeClassification);
    const diffLines = computeComponentDiffLines(
      item.current,
      item.proposed as unknown as Record<string, unknown>,
      item.changeClassification,
    );
    for (const d of diffLines) {
      lines.push({ key: `comp-d-${item.current.name}-${d.key}`, color: d.color, text: ` ${d.text}` });
    }
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
    lines.push({ key: `tok-new-${name}`, color: PALETTE.success, text: ` + ${name}` });
  }
  for (const item of tokens.removed) {
    lines.push({ key: `tok-rm-${item.name}`, color: PALETTE.error, text: ` - ${item.name}` });
  }
  for (const item of tokens.changed) {
    const tokenName = (item.current as DesignTokenSummary).name;
    appendChangedPreviewLine(lines, 'tok', tokenName, item.hasPendingDraftChanges, item.changeClassification);
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
  onQuit,
}: WizardPreviewStepProps): React.ReactElement {
  const breakingWithImpact = hasBreakingChangesWithImpact(preview);
  const [diffExpanded, setDiffExpanded] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const { columns: terminalColumns, rows: terminalRows } = useTerminalSize();
  const summaryLines = useMemo(() => buildPreviewSummaryLines(preview), [preview]);
  const diffLines = useMemo(() => buildPreviewDiffLines(preview), [preview]);
  const handlePreviewInput = usePreviewConfirmationInput(breakingWithImpact, onConfirm);

  const { components, tokens } = preview;
  const hasComponents = components.new.length + components.changed.length + components.removed.length > 0;
  const hasTokens = tokens.new.length + tokens.changed.length + tokens.removed.length > 0;
  const hasAnything = hasComponents || hasTokens;
  // WizardApp renders the one-line global TopBar above this step.
  const panelHeight = terminalPanelHeight(terminalRows, 19 + (breakingWithImpact ? 2 : 0));
  const panelContentHeight = Math.max(1, panelHeight - 4);
  const viewportHeight = Math.max(1, panelContentHeight - 1);
  const activeLines = diffExpanded ? diffLines : summaryLines;
  const maxScroll = Math.max(0, activeLines.length - viewportHeight);
  const boundedScrollOffset = Math.min(scrollOffset, maxScroll);

  useEffect(() => {
    setScrollOffset((previous) => Math.min(previous, maxScroll));
  }, [maxScroll]);

  useImmediateInput((input, key) => {
    if (handlePreviewInput(input, key)) {
      return;
    }
    if (input === 'd' || input === 'D') {
      setDiffExpanded((prev) => !prev);
      setScrollOffset(0);
      return;
    }
    if (diffExpanded) {
      if (key.downArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxScroll));
        return;
      }
      if (key.upArrow) {
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
    } else {
      if (key.downArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxScroll));
        return;
      }
      if (key.upArrow) {
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
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }
  });

  return (
    <Box flexDirection="column" gap={1} paddingX={2} paddingY={2}>
      <StepHeader stepNumber={stepNumber} totalSteps={totalSteps} title="Push to Contentful" />

      {hasAnything ? (
        <>
          <Text>Here&apos;s what will happen in your space:</Text>
          <WindowedPanel
            width={Math.max(20, terminalColumns - 4)}
            height={panelHeight}
            title={diffExpanded ? `Diff (${diffLines.length} lines)` : 'Component types'}
            focused={false}
          >
            {activeLines.slice(boundedScrollOffset, boundedScrollOffset + viewportHeight).map((line) => (
              <Text
                key={line.key}
                color={line.color === 'gray' ? undefined : line.color}
                dimColor={line.color === 'gray'}
                wrap="truncate-end"
              >
                {line.text}
              </Text>
            ))}
            <Text dimColor wrap="truncate-end">
              {formatPreviewScrollIndicator(activeLines.length, boundedScrollOffset, viewportHeight)}
            </Text>
          </WindowedPanel>
        </>
      ) : (
        <Text dimColor>Nothing to push — everything is already up to date.</Text>
      )}

      {breakingWithImpact && (
        <Box marginTop={1}>
          <Text color={PALETTE.error} bold>
            ⚠ Breaking changes will affect downstream entities. Press Enter to acknowledge and apply.
          </Text>
        </Box>
      )}

      <SpaceEnvironment spaceId={spaceId} environmentId={environmentId} />

      <Box gap={3} marginTop={1}>
        <Text dimColor>[Enter] Push to Contentful</Text>
        <Text dimColor>[d] {diffExpanded ? 'Hide' : 'Show'} diff</Text>
        {maxScroll > 0 && <Text dimColor>[↑↓] Scroll [f/b] Page</Text>}
        {onEdit && <Text dimColor>[e] Edit definitions</Text>}
        <Text dimColor>[q] Cancel</Text>
      </Box>
    </Box>
  );
}
