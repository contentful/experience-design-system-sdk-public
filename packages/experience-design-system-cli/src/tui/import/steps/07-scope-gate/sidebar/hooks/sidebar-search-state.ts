import { useState } from 'react';
import type { FilterCategory } from '../step-filters.js';

export function useSidebarSearchState() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autocompleteCandidates, setAutocompleteCandidates] = useState<string[]>([]);
  const [jumpFilterTarget, setJumpFilterTarget] = useState<string | null>(null);
  const [columnOneView, setColumnOneView] = useState<'grouped' | 'flat'>('grouped');
  const [activeFilters, setActiveFilters] = useState<Set<FilterCategory>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    autocompleteCandidates,
    setAutocompleteCandidates,
    jumpFilterTarget,
    setJumpFilterTarget,
    columnOneView,
    setColumnOneView,
    activeFilters,
    setActiveFilters,
    showHelp,
    setShowHelp,
  };
}
