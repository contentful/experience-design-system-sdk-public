import React from 'react';
import { Box, Text } from 'ink';
import type { ReviewComponentSummary, ReviewComponentStatus } from '../../types.js';

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

export function sortComponentsForSidebar(components: ReviewComponentSummary[]): ReviewComponentSummary[] {
  const withErrors = components.filter((c) => c.validationErrorCount > 0);
  const withWarnings = components.filter((c) => c.validationErrorCount === 0 && c.validationWarningCount > 0);
  const clean = components.filter((c) => c.validationErrorCount === 0 && c.validationWarningCount === 0);
  return [...withErrors, ...withWarnings, ...clean];
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
    <Box flexDirection="column" width={width} borderStyle="single" borderColor={focused ? 'white' : undefined}>
      {showScrollUp && !collapsed && <Text dimColor>▲</Text>}
      {visible.map((component) => {
        const isSelected = component.id === selectedId;
        const icon = statusIcon(component.status, component.validationErrorCount, component.validationWarningCount);
        const color = statusColor(component.status, component.validationErrorCount, component.validationWarningCount);
        const maxNameLen = Math.max(1, width - 4);
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
            <Text color={color} inverse={isSelected && focused} underline={isSelected && !focused} wrap="truncate">
              {icon + ' ' + name}
            </Text>
          </Box>
        );
      })}
      {showScrollDown && !collapsed && <Text dimColor>▼</Text>}
    </Box>
  );
}
