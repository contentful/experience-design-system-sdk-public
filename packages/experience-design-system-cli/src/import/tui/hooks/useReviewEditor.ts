import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { openPipelineDb, storeCDFComponents } from '../../../session/db.js';
import {
  collectTokenSuggestions,
  type TokenPropSuggestion,
  type TokenReviewToken,
} from '../../../analyze/select/tui/components/TokenReviewPanel.js';
import type { ReviewComponentStatus } from '../../../analyze/select/types.js';
import type { CdfReviewEntry } from './useReviewSession.js';

export type ReviewPanel = 'none' | 'prop-rationale' | 'component-rationale' | 'source' | 'token-review';

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
  handleEditSave: () => void;
  handleEditDiscard: () => void;
  handleTokenEditSave: (suggestion: TokenPropSuggestion) => void;
};

function parseReviewEntry(draftValue: string): CDFComponentEntry {
  const parsed = JSON.parse(draftValue) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  const entry =
    keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null
      ? (parsed[keys[0]] as CDFComponentEntry)
      : (parsed as unknown as CDFComponentEntry);
  if (entry.$type !== 'component' || typeof entry.$properties !== 'object' || entry.$properties === null) {
    throw new Error('Invalid CDF entry: must have $type: "component" and $properties object');
  }
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

  const handleEditSave = (): void => {
    const current = components[selectedIdx];
    if (!current) return;
    try {
      const entry = parseReviewEntry(draftValue);
      const next = components.map((component, index) =>
        index === selectedIdx
          ? {
              ...component,
              entry,
              status: component.status === 'needs-review' ? ('accepted' as ReviewComponentStatus) : component.status,
            }
          : component,
      );
      setComponents(next);
      setDraftValue('');
      setSaveError(null);
      const db = openPipelineDb();
      try {
        storeCDFComponents(db, extractSessionId, [{ key: current.key, entry }]);
      } finally {
        db.close();
      }
      onEditSaved(next);
    } catch (error: unknown) {
      setSaveError(String(error));
    }
  };

  const handleEditDiscard = (): void => {
    setDraftValue('');
    setSaveError(null);
  };

  const persistTokenFields = (propName: string, allowed: string[]): void => {
    const current = components[selectedIdx];
    if (!current) return;
    const prop = current.entry.$properties[propName];
    if (!prop) return;
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
    setComponents(next);
    const db = openPipelineDb();
    try {
      storeCDFComponents(db, extractSessionId, [{ key: current.key, entry: nextEntry }]);
    } finally {
      db.close();
    }
    pushHistorySnapshot(next, `token-review:${propName}`);
    onTokenSaved(next);
  };

  const handleTokenEditSave = (suggestion: TokenPropSuggestion): void => {
    const allowed = suggestion.paths.filter((path) => tokenReviewEditSelection.has(path));
    if (allowed.length === 0) return;
    persistTokenFields(suggestion.propName, allowed);
    setTokenReviewEditing(false);
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
    handleEditDiscard,
    handleTokenEditSave,
  };
}
