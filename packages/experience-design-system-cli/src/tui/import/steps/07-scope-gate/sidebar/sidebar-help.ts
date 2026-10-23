import type { HelpSection } from './components/HelpOverlay.js';

export function createSidebarViewsHelpSection(includeBreaking: boolean): HelpSection {
  const entries: HelpSection['entries'] = [
    { keys: 'L', label: 'Flat view' },
    { keys: 'i', label: 'Focus lineage' },
  ];
  if (includeBreaking) entries.push({ keys: 'w', label: 'Show only components with breaking changes' });
  entries.push(
    { keys: 'o', label: 'Show only components in slot cycles' },
    { keys: 'space', label: 'Expand/collapse group' },
    { keys: 'E / C', label: 'Expand/collapse all' },
  );
  return { title: 'Sidebar views', entries };
}
