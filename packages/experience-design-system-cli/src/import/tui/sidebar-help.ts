import type { HelpSection } from '../../analyze/select/tui/components/HelpOverlay.js';

export function createSidebarViewsHelpSection(includeBreaking: boolean): HelpSection {
  const entries: HelpSection['entries'] = [
    { keys: 'L', label: 'Flat view' },
    { keys: 'l', label: 'Lineage' },
    { keys: 'i', label: 'Focus lineage' },
  ];
  if (includeBreaking) entries.push({ keys: 'w', label: 'Only breaking' });
  entries.push(
    { keys: 'o', label: 'Only cycles' },
    { keys: 'space', label: 'Expand/collapse group' },
    { keys: 'E / C', label: 'Expand/collapse all' },
  );
  return { title: 'Sidebar views', entries };
}
