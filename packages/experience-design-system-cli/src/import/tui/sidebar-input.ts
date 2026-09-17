import { computeAutocomplete } from './autocomplete.js';

type SearchInputKey = {
  tab: boolean;
  backspace: boolean;
};

type SearchInputOptions = {
  query: string;
  names: string[];
  setQuery: (value: string | ((current: string) => string)) => void;
  setCandidates: (value: string[]) => void;
};

export function handleSidebarSearchInput(
  input: string,
  key: SearchInputKey,
  { query, names, setQuery, setCandidates }: SearchInputOptions,
): boolean {
  if (key.tab) {
    const { completion, candidates } = computeAutocomplete(query, names);
    setQuery(completion);
    setCandidates(candidates);
    return true;
  }
  if (key.backspace) {
    setCandidates([]);
    setQuery((current) => current.slice(0, -1));
    return true;
  }
  if (input && input.length === 1 && input >= ' ' && input !== '\r' && input !== '\n') {
    setCandidates([]);
    setQuery((current) => current + input);
    return true;
  }
  return false;
}

export function formatSearchMatchSummary(matches: number, total: number): string {
  return `  (${matches}/${total} matches)`;
}
