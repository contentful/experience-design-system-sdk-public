import React from 'react';
import { Box, Text } from 'ink';
import type { PreviewAnnotation, ReviewComponentSummary, ReviewComponentStatus } from '../../types.js';

/**
 * Pilot-2026-06-23 R2: render a single-character preview-diff badge directly
 * before each component name in the sidebar so operators can scan the diff
 * shape at a glance without opening each row. Returns null for unannotated
 * rows so the row falls back to its existing single-space layout.
 */
export function previewBadge(
  annotation: PreviewAnnotation | undefined,
): { char: string; color: string; bold?: boolean; dim?: boolean } | null {
  switch (annotation) {
    case 'new':
      return { char: '+', color: 'green' };
    case 'changed':
      return { char: '~', color: 'yellow' };
    case 'removed':
      return { char: '-', color: 'red', dim: true };
    case 'breaking':
      return { char: '!', color: 'red', bold: true };
    default:
      return null;
  }
}

type SidebarProps = {
  components: ReviewComponentSummary[];
  selectedId: string | null;
  focused: boolean;
  scrollOffset: number;
  visibleCount: number;
  onSelect: (id: string) => void;
  onScrollChange: (offset: number) => void;
  collapsed?: boolean;
  width?: number;
};

export function statusIcon(
  status: ReviewComponentStatus,
  validationErrorCount: number,
  // Warnings deliberately do NOT override the icon — the user's accept/reject
  // decision must remain visible. Color is already yellow via statusColor for
  // warning-only components, so the warning cue is preserved.
  _validationWarningCount: number,
): string {
  // Errors override — a structurally broken component should never render as ✓/✗.
  if (validationErrorCount > 0) return '⚠';
  switch (status) {
    case 'accepted':
      return '✓';
    case 'rejected':
      return '✗';
    case 'reviewed':
      return '~';
    case 'needs-review':
      return '·';
  }
}

export function statusColor(
  status: ReviewComponentStatus,
  validationErrorCount: number,
  validationWarningCount: number,
): string {
  if (validationErrorCount > 0) return 'red';
  if (validationWarningCount > 0) return 'yellow';
  switch (status) {
    case 'accepted':
      return 'green';
    case 'rejected':
      return 'red';
    case 'reviewed':
      return 'yellow';
    case 'needs-review':
      return 'white';
  }
}

function truncateName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen) + '…';
}

/**
 * Sort key for stable secondary ordering within a validation tier:
 * needs-review components first, then by extractionConfidence ascending
 * (lowest confidence first, null treated as highest = last). Used to be
 * applied inline in App.tsx, then this helper sorted again — pulled in
 * here so the sort happens once.
 */
function withinTierComparator(a: ReviewComponentSummary, b: ReviewComponentSummary): number {
  const aPending = a.needsReview && a.status === 'needs-review' ? 0 : 1;
  const bPending = b.needsReview && b.status === 'needs-review' ? 0 : 1;
  if (aPending !== bPending) return aPending - bPending;
  return (a.extractionConfidence ?? 6) - (b.extractionConfidence ?? 6);
}

export function sortComponentsForSidebar(components: ReviewComponentSummary[]): ReviewComponentSummary[] {
  const withErrors = components.filter((c) => c.validationErrorCount > 0);
  const withWarnings = components.filter((c) => c.validationErrorCount === 0 && c.validationWarningCount > 0);
  const clean = components.filter((c) => c.validationErrorCount === 0 && c.validationWarningCount === 0);
  return [
    ...[...withErrors].sort(withinTierComparator),
    ...[...withWarnings].sort(withinTierComparator),
    ...[...clean].sort(withinTierComparator),
  ];
}

export function Sidebar({
  components,
  selectedId,
  focused,
  scrollOffset,
  visibleCount,
  collapsed = false,
  width: widthProp,
}: SidebarProps): React.ReactElement {
  const sorted = sortComponentsForSidebar(components);
  const visible = sorted.slice(scrollOffset, scrollOffset + visibleCount);
  const showScrollUp = scrollOffset > 0;
  const showScrollDown = scrollOffset + visibleCount < sorted.length;
  const width = collapsed ? 3 : (widthProp ?? 18);

  return (
    <Box
      flexDirection="column"
      width={width}
      flexShrink={0}
      borderStyle="single"
      borderColor={focused ? 'white' : undefined}
    >
      {showScrollUp && !collapsed && <Text dimColor>▲</Text>}
      {visible.map((component) => {
        const isSelected = component.id === selectedId;
        const icon = statusIcon(component.status, component.validationErrorCount, component.validationWarningCount);
        const color = statusColor(component.status, component.validationErrorCount, component.validationWarningCount);
        const badge = previewBadge(component.previewAnnotation);
        // Reserve one column for the preview badge regardless of whether this
        // row has one — keeps name truncation stable across rows so the column
        // width doesn't jitter as annotations flip in/out.
        const maxNameLen = Math.max(1, width - 5);
        const name = truncateName(component.name, maxNameLen);

        if (collapsed) {
          return (
            <Box key={component.id}>
              <Text color={color} inverse={isSelected && focused} underline={isSelected && !focused}>
                {icon}
              </Text>
            </Box>
          );
        }

        return (
          <Box key={component.id}>
            <Text color={color} inverse={isSelected && focused} underline={isSelected && !focused}>
              {icon}
            </Text>
            {badge ? (
              <Text color={badge.color} bold={badge.bold} dimColor={badge.dim}>
                {badge.char}
              </Text>
            ) : (
              <Text> </Text>
            )}
            <Text color={color} inverse={isSelected && focused} underline={isSelected && !focused} wrap="truncate">
              {' ' + name}
            </Text>
          </Box>
        );
      })}
      {showScrollDown && !collapsed && <Text dimColor>▼</Text>}
    </Box>
  );
}
