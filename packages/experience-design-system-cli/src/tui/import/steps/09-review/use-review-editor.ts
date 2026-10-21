import { parseStrictJson } from '@contentful/experience-design-system-types';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { CDFComponentSchema, type CDFComponentEntry } from '@contentful/experience-design-system-types';
import { persistReviewEntry } from './persist-review-entry.js';
import { collectTokenSuggestions } from './token-suggestions.js';
import type {
  CdfReviewEntry,
  ReviewComponentStatus,
  ReviewPanel,
  TokenPropSuggestion,
  TokenReviewToken,
} from './types.js';
type UseReviewEditorOptions = {
  components: CdfReviewEntry[];
  selectedIdx: number;
  extractSessionId: string;
  availableTokens: TokenReviewToken[];
  setComponents: Dispatch<SetStateAction<CdfReviewEntry[]>>;
  pushHistorySnapshot: (entries: CdfReviewEntry[], label: string) => void;
  onEditSaved: (entries: CdfReviewEntry[]) => void;
  onTokenSaved: (entries: CdfReviewEntry[]) => void;
};

export type UseReviewEditorResult = {
  panelOpen: ReviewPanel;
  setPanelOpen: Dispatch<SetStateAction<ReviewPanel>>;
  panelScrollOffset: number;
  setPanelScrollOffset: Dispatch<SetStateAction<number>>;
  jsonScrollOffset: number;
  setJsonScrollOffset: Dispatch<SetStateAction<number>>;
  textEntryActive: boolean;
  setTextEntryActive: Dispatch<SetStateAction<boolean>>;
  showJson: boolean;
  setShowJson: Dispatch<SetStateAction<boolean>>;
  showHiddenProps: boolean;
  setShowHiddenProps: Dispatch<SetStateAction<boolean>>;
  draftValue: string;
  setDraftValue: Dispatch<SetStateAction<string>>;
  saveError: string | null;
  setSaveError: Dispatch<SetStateAction<string | null>>;
  tokenReviewRow: number;
  setTokenReviewRow: Dispatch<SetStateAction<number>>;
  tokenReviewEditing: boolean;
  setTokenReviewEditing: Dispatch<SetStateAction<boolean>>;
  tokenReviewEditCursor: number;
  setTokenReviewEditCursor: Dispatch<SetStateAction<number>>;
  tokenReviewEditSelection: Set<string>;
  setTokenReviewEditSelection: Dispatch<SetStateAction<Set<string>>>;
  pendingGRef: { current: boolean };
  currentTokenSuggestions: () => TokenPropSuggestion[];
  handleEditSave: (value?: string) => boolean;
  setDraftValid: Dispatch<SetStateAction<boolean>>;
  handleEditDiscard: () => void;
  handleTokenEditSave: (suggestion: TokenPropSuggestion) => boolean;
};

function parseReviewEntry(draftValue: string): CDFComponentEntry {
  const parsed = parseStrictJson(draftValue) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  const entry =
    keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null
      ? (parsed[keys[0]] as CDFComponentEntry)
      : (parsed as unknown as CDFComponentEntry);
  const validation = CDFComponentSchema.safeParse(entry);
  if (!validation.success)
    throw new Error(`Invalid complete CDF entry: ${validation.error.issues.map((issue) => issue.message).join('; ')}`);
  return entry;
}

export function useReviewEditor({
  components,
  selectedIdx,
  extractSessionId,
  availableTokens,
  setComponents,
  pushHistorySnapshot,
  onEditSaved,
  onTokenSaved,
}: UseReviewEditorOptions): UseReviewEditorResult {
  const [panelOpen, setPanelOpen] = useState<ReviewPanel>('none');
  const [panelScrollOffset, setPanelScrollOffset] = useState(0);
  const [jsonScrollOffset, setJsonScrollOffset] = useState(0);
  const [textEntryActive, setTextEntryActive] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [showHiddenProps, setShowHiddenProps] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [draftValid, setDraftValid] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tokenReviewRow, setTokenReviewRow] = useState(0);
  const [tokenReviewEditing, setTokenReviewEditing] = useState(false);
  const [tokenReviewEditCursor, setTokenReviewEditCursor] = useState(0);
  const [tokenReviewEditSelection, setTokenReviewEditSelection] = useState<Set<string>>(new Set());
  const tokenReviewSuggestedRef = useRef(new Map<string, string[]>());
  const pendingGRef = useRef(false);

  useEffect(() => {
    setTokenReviewRow(0);
    setTokenReviewEditing(false);
    setTokenReviewEditCursor(0);
    setTokenReviewEditSelection(new Set());
    setJsonScrollOffset(0);
  }, [selectedIdx]);

  const currentTokenSuggestions = (): TokenPropSuggestion[] => {
    const current = components[selectedIdx];
    if (!current) return [];
    return collectTokenSuggestions(current.entry, availableTokens).map((suggestion) => {
      const snapshotKey = `${current.key}::${suggestion.propName}`;
      const suggested = tokenReviewSuggestedRef.current.get(snapshotKey) ?? [...suggestion.suggested];
      tokenReviewSuggestedRef.current.set(snapshotKey, suggested);
      return { ...suggestion, suggested };
    });
  };

  const handleEditSave = (value?: string): boolean => {
    const current = components[selectedIdx];
    if (!current) return false;
    if (!draftValid) {
      setSaveError('Correct the visible draft before saving');
      return false;
    }
    const draft = value ?? draftValue;
    if (draft.trim() === '') return true;
    try {
      const entry = parseReviewEntry(draft);
      const next = components.map((component, index) =>
        index === selectedIdx
          ? {
              ...component,
              entry,
              status: component.status === 'needs-review' ? ('accepted' as ReviewComponentStatus) : component.status,
            }
          : component,
      );
      const persisted = persistReviewEntry(extractSessionId, current, entry);
      if (!persisted.ok) throw new Error(persisted.error);
      setComponents(next);
      setDraftValue('');
      setSaveError(null);
      const warnings = [...persisted.warnings];
      try {
        onEditSaved(next);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : 'Saved callback failed');
      }
      if (warnings.length) setSaveError(`Saved; warning: ${warnings.join('; ')}`);
      return true;
    } catch (error: unknown) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
      return false;
    }
  };

  const handleEditDiscard = (): void => {
    setDraftValue('');
    setDraftValid(true);
    setSaveError(null);
  };

  const persistTokenFields = (propName: string, allowed: string[]): string[] => {
    const current = components[selectedIdx];
    if (!current) throw new Error('No selected component');
    const prop = current.entry.$properties[propName];
    if (!prop) throw new Error('No selected property');
    const nextEntry: CDFComponentEntry = {
      ...current.entry,
      $properties: {
        ...current.entry.$properties,
        [propName]: { ...prop, '$token.allowed': allowed },
      },
    };
    const next = components.map((component, index) =>
      index === selectedIdx ? { ...component, entry: nextEntry } : component,
    );
    const persisted = persistReviewEntry(extractSessionId, current, nextEntry);
    if (!persisted.ok) throw new Error(persisted.error);
    setComponents(next);
    const warnings = [...persisted.warnings];
    try {
      pushHistorySnapshot(next, `token-review:${propName}`);
      onTokenSaved(next);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Saved callback failed');
    }
    return warnings;
  };

  const handleTokenEditSave = (suggestion: TokenPropSuggestion): boolean => {
    const allowed = suggestion.paths.filter((path) => tokenReviewEditSelection.has(path));
    if (allowed.length === 0) return false;
    try {
      const warnings = persistTokenFields(suggestion.propName, allowed);
      setTokenReviewEditing(false);
      setSaveError(warnings.length ? `Saved; warning: ${warnings.join('; ')}` : null);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Save failed');
      return false;
    }
  };

  return {
    panelOpen,
    setPanelOpen,
    panelScrollOffset,
    setPanelScrollOffset,
    jsonScrollOffset,
    setJsonScrollOffset,
    textEntryActive,
    setTextEntryActive,
    showJson,
    setShowJson,
    showHiddenProps,
    setShowHiddenProps,
    draftValue,
    setDraftValue,
    saveError,
    setSaveError,
    tokenReviewRow,
    setTokenReviewRow,
    tokenReviewEditing,
    setTokenReviewEditing,
    tokenReviewEditCursor,
    setTokenReviewEditCursor,
    tokenReviewEditSelection,
    setTokenReviewEditSelection,
    pendingGRef,
    currentTokenSuggestions,
    handleEditSave,
    setDraftValid,
    handleEditDiscard,
    handleTokenEditSave,
  };
}
