import type {
  PreviewAnnotation,
  ReviewComponentRecord,
  ReviewComponentStatus,
  ReviewSessionSnapshot,
} from '../types.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { stripScoringFields } from '../../../types.js';
import { computeScrollOffset } from './utils.js';

// ── Mode union ────────────────────────────────────────────────────────────────

export type AppMode =
  | { type: 'browsing'; sidebarFocused: boolean; sourceVisible: boolean }
  | { type: 'editing'; componentId: string }
  | { type: 'dialog'; which: 'help' | 'finalize' | 'quit' }
  | { type: 'finalized'; accepted: number; rejected: number; excluded: number };

// ── Editor state (cursor + undo) ──────────────────────────────────────────────

export type EditorCursor = { lines: string[]; cursorRow: number; cursorCol: number };

export type EditorState = {
  cursor: EditorCursor;
  undoStack: EditorCursor[];
  scrollRow: number;
  validationError: string | null;
};

function makeEditorState(value: string): EditorState {
  return {
    cursor: { lines: value.split('\n'), cursorRow: 0, cursorCol: 0 },
    undoStack: [],
    scrollRow: 0,
    validationError: null,
  };
}

function editorWithCursor(e: EditorState, next: EditorCursor): EditorState {
  return {
    ...e,
    cursor: next,
    undoStack: e.undoStack.length >= 50 ? [...e.undoStack.slice(1), e.cursor] : [...e.undoStack, e.cursor],
  };
}

function syncEditorScroll(e: EditorState, visibleHeight: number): EditorState {
  const { cursorRow } = e.cursor;
  let { scrollRow } = e;
  if (cursorRow < scrollRow) scrollRow = cursorRow;
  if (cursorRow >= scrollRow + visibleHeight) scrollRow = cursorRow - visibleHeight + 1;
  return scrollRow === e.scrollRow ? e : { ...e, scrollRow };
}

// Pure: apply one keypress to EditorState. Returns null if key has no effect.
export function applyEditorKey(
  e: EditorState,
  input: string,
  key: {
    ctrl: boolean;
    meta: boolean;
    return: boolean;
    backspace: boolean;
    delete: boolean;
    escape: boolean;
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
  },
  visibleHeight: number,
): EditorState | null {
  const { lines, cursorRow, cursorCol } = e.cursor;

  // Ctrl+Z undo
  if (key.ctrl && input === 'z') {
    if (e.undoStack.length === 0) return null;
    const prev = e.undoStack[e.undoStack.length - 1]!;
    return syncEditorScroll({ ...e, cursor: prev, undoStack: e.undoStack.slice(0, -1) }, visibleHeight);
  }

  let newLines = [...lines];
  let newRow = cursorRow;
  let newCol = cursorCol;

  if (key.return) {
    const before = newLines[cursorRow].slice(0, cursorCol);
    const after = newLines[cursorRow].slice(cursorCol);
    newLines = [...newLines.slice(0, cursorRow), before, after, ...newLines.slice(cursorRow + 1)];
    newRow = cursorRow + 1;
    newCol = 0;
  } else if (key.backspace) {
    if (cursorCol > 0) {
      newLines[cursorRow] = newLines[cursorRow].slice(0, cursorCol - 1) + newLines[cursorRow].slice(cursorCol);
      newCol = cursorCol - 1;
    } else if (cursorRow > 0) {
      const prevLen = newLines[cursorRow - 1].length;
      newLines[cursorRow - 1] = newLines[cursorRow - 1] + newLines[cursorRow];
      newLines = [...newLines.slice(0, cursorRow), ...newLines.slice(cursorRow + 1)];
      newRow = cursorRow - 1;
      newCol = prevLen;
    } else {
      return null;
    }
  } else if (key.delete) {
    if (cursorCol < newLines[cursorRow].length) {
      newLines[cursorRow] = newLines[cursorRow].slice(0, cursorCol) + newLines[cursorRow].slice(cursorCol + 1);
    } else if (cursorRow < newLines.length - 1) {
      newLines[cursorRow] = newLines[cursorRow] + newLines[cursorRow + 1];
      newLines = [...newLines.slice(0, cursorRow + 1), ...newLines.slice(cursorRow + 2)];
    } else {
      return null;
    }
  } else if (key.leftArrow) {
    if (cursorCol > 0) {
      newCol = cursorCol - 1;
    } else if (cursorRow > 0) {
      newRow = cursorRow - 1;
      newCol = newLines[cursorRow - 1].length;
    } else return null;
  } else if (key.rightArrow) {
    if (cursorCol < newLines[cursorRow].length) {
      newCol = cursorCol + 1;
    } else if (cursorRow < newLines.length - 1) {
      newRow = cursorRow + 1;
      newCol = 0;
    } else return null;
  } else if (key.upArrow) {
    if (cursorRow === 0) return null;
    newRow = cursorRow - 1;
    newCol = Math.min(cursorCol, newLines[newRow].length);
  } else if (key.downArrow) {
    if (cursorRow >= newLines.length - 1) return null;
    newRow = cursorRow + 1;
    newCol = Math.min(cursorCol, newLines[newRow].length);
  } else if (input === '\x1b[H' || input === '\x1b[1~') {
    newCol = 0; // Home
  } else if (input === '\x1b[F' || input === '\x1b[4~') {
    newCol = newLines[cursorRow].length; // End
  } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
    newLines[cursorRow] = newLines[cursorRow].slice(0, cursorCol) + input + newLines[cursorRow].slice(cursorCol);
    newCol = cursorCol + 1;
  } else {
    return null;
  }

  return syncEditorScroll(
    editorWithCursor(e, { lines: newLines, cursorRow: newRow, cursorCol: newCol }),
    visibleHeight,
  );
}

// ── App State ─────────────────────────────────────────────────────────────────

export type AppState = {
  mode: AppMode;
  session: ReviewSessionSnapshot | null;
  paths: { sessionDir: string; statePath: string; eventsPath: string } | null;
  selectedId: string | null;
  sortedIds: string[];
  sidebarScrollOffset: number;
  jsonScrollOffset: number;
  draftsByComponentId: Record<string, string>;
  editor: EditorState | null; // non-null only when mode.type === 'editing'
  sourceCodeById: Record<string, string>;
  previewAnnotations: Record<string, PreviewAnnotation>;
  previewResponse: ServerPreviewResponse | null;
  previewLoading: boolean;
  previewError: string | null;
  saveError: string | null;
};

export const initialState: AppState = {
  mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false },
  session: null,
  paths: null,
  selectedId: null,
  sortedIds: [],
  sidebarScrollOffset: 0,
  jsonScrollOffset: 0,
  draftsByComponentId: {},
  editor: null,
  sourceCodeById: {},
  previewAnnotations: (() => {
    const raw = process.env['EDS_PREVIEW_ANNOTATIONS'];
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, PreviewAnnotation>;
    } catch {
      return {};
    }
  })(),
  previewResponse: null,
  previewLoading: false,
  previewError: null,
  saveError: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type AppAction =
  | { type: 'SESSION_LOADED'; session: ReviewSessionSnapshot; paths: AppState['paths'] }
  | { type: 'SELECT'; id: string }
  | { type: 'SIDEBAR_UP'; visibleCount: number }
  | { type: 'SIDEBAR_DOWN'; visibleCount: number }
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'APPROVE_ALL' }
  | { type: 'ENTER_EDIT' }
  | { type: 'EDITOR_KEY'; input: string; key: Parameters<typeof applyEditorKey>[2]; visibleHeight: number }
  | { type: 'EDITOR_VALIDATE' } // Ctrl+S: validate JSON; if valid, transition to browsing (side effect persists draft)
  | { type: 'DRAFT_DISCARD' }
  | { type: 'TOGGLE_FOCUS' }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN' }
  | { type: 'TOGGLE_SOURCE'; terminalWidth: number }
  | { type: 'OPEN_DIALOG'; which: 'help' | 'finalize' | 'quit' }
  | { type: 'CLOSE_DIALOG' }
  | { type: 'FINALIZE_CONFIRM' }
  | { type: 'QUIT_CONFIRM' }
  | { type: 'SOURCE_LOADED'; componentId: string; code: string }
  | { type: 'PREVIEW_START' }
  | { type: 'PREVIEW_SUCCESS'; response: ServerPreviewResponse; annotations: Record<string, PreviewAnnotation> }
  | { type: 'PREVIEW_ERROR'; message: string }
  | { type: 'SAVE_ERROR'; message: string }
  | { type: 'CLEAR_ERRORS' }
  | { type: 'DRAFT_PERSIST_DONE'; componentId: string; updatedComponents: ReviewComponentRecord[] };

// ── Derived sort ──────────────────────────────────────────────────────────────

function computeSortedIds(
  components: ReviewSessionSnapshot['components'],
  annotations: Record<string, PreviewAnnotation>,
): string[] {
  return [...components]
    .map((c) => ({
      id: c.id,
      needsReview: c.originalProposal.needsReview ?? false,
      status: c.status,
      conf: c.originalProposal.extractionConfidence ?? 6,
      _annotation: annotations[c.name],
    }))
    .sort((a, b) => {
      const aF = a.needsReview && a.status === 'needs-review' ? 0 : 1;
      const bF = b.needsReview && b.status === 'needs-review' ? 0 : 1;
      if (aF !== bF) return aF - bF;
      return a.conf - b.conf;
    })
    .map((c) => c.id);
}

function updateStatus(state: AppState, newStatus: ReviewComponentStatus): AppState {
  if (!state.session || !state.selectedId) return state;
  const components = state.session.components.map((c) => (c.id === state.selectedId ? { ...c, status: newStatus } : c));
  return { ...state, session: { ...state.session, components } };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SESSION_LOADED': {
      const sortedIds = computeSortedIds(action.session.components, state.previewAnnotations);
      return { ...state, session: action.session, paths: action.paths, sortedIds, selectedId: sortedIds[0] ?? null };
    }

    case 'SELECT':
      return { ...state, selectedId: action.id, jsonScrollOffset: 0 };

    case 'SIDEBAR_UP': {
      if (!state.session || !state.selectedId) return state;
      const idx = state.sortedIds.indexOf(state.selectedId);
      if (idx <= 0) return state;
      const ni = idx - 1;
      return {
        ...state,
        selectedId: state.sortedIds[ni]!,
        jsonScrollOffset: 0,
        sidebarScrollOffset: computeScrollOffset(ni, state.sidebarScrollOffset, action.visibleCount),
      };
    }

    case 'SIDEBAR_DOWN': {
      if (!state.session || !state.selectedId) return state;
      const idx = state.sortedIds.indexOf(state.selectedId);
      if (idx >= state.sortedIds.length - 1) return state;
      const ni = idx + 1;
      return {
        ...state,
        selectedId: state.sortedIds[ni]!,
        jsonScrollOffset: 0,
        sidebarScrollOffset: computeScrollOffset(ni, state.sidebarScrollOffset, action.visibleCount),
      };
    }

    case 'ACCEPT':
      return updateStatus(state, 'accepted');
    case 'REJECT':
      return updateStatus(state, 'rejected');

    case 'APPROVE_ALL': {
      if (!state.session) return state;
      const components = state.session.components.map((c) =>
        c.status === 'needs-review' ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
      );
      return { ...state, session: { ...state.session, components } };
    }

    case 'ENTER_EDIT': {
      if (state.mode.type !== 'browsing' || !state.selectedId || !state.session) return state;
      const component = state.session.components.find((c) => c.id === state.selectedId);
      if (!component) return state;
      const existing = state.draftsByComponentId[state.selectedId];
      const draft = existing ?? JSON.stringify(stripScoringFields(component.editedProposal), null, 2);
      const editor = makeEditorState(draft);
      return {
        ...state,
        mode: { type: 'editing', componentId: state.selectedId },
        draftsByComponentId: { ...state.draftsByComponentId, [state.selectedId]: draft },
        editor,
      };
    }

    case 'EDITOR_KEY': {
      if (!state.editor || state.mode.type !== 'editing') return state;
      const next = applyEditorKey(state.editor, action.input, action.key, action.visibleHeight);
      if (!next) return state;
      const newValue = next.cursor.lines.join('\n');
      return {
        ...state,
        editor: next,
        draftsByComponentId: { ...state.draftsByComponentId, [state.mode.componentId]: newValue },
      };
    }

    case 'EDITOR_VALIDATE': {
      // inputToAction calls this on Ctrl+S — reducer does the parse check
      if (!state.editor || state.mode.type !== 'editing') return state;
      const text = state.editor.cursor.lines.join('\n');
      try {
        JSON.parse(text);
        // Valid — switch mode back to browsing; side effect will detect the transition and persist
        return {
          ...state,
          editor: { ...state.editor, validationError: null },
          mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false },
          // keep draft in draftsByComponentId — side effect will persist it and clear it
        };
      } catch (e) {
        return {
          ...state,
          editor: { ...state.editor, validationError: e instanceof Error ? e.message : String(e) },
        };
      }
    }

    case 'DRAFT_DISCARD': {
      if (state.mode.type !== 'editing') return state;
      const { componentId } = state.mode;
      const { [componentId]: _removed, ...remaining } = state.draftsByComponentId;
      return {
        ...state,
        mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false },
        draftsByComponentId: remaining,
        editor: null,
      };
    }

    case 'DRAFT_PERSIST_DONE': {
      const { componentId, updatedComponents } = action;
      const { [componentId]: _removed, ...remaining } = state.draftsByComponentId;
      return {
        ...state,
        session: state.session ? { ...state.session, components: updatedComponents } : state.session,
        draftsByComponentId: remaining,
      };
    }

    case 'TOGGLE_FOCUS': {
      if (state.mode.type !== 'browsing') return state;
      return { ...state, mode: { ...state.mode, sidebarFocused: !state.mode.sidebarFocused } };
    }

    case 'SCROLL_UP':
      return { ...state, jsonScrollOffset: Math.max(0, state.jsonScrollOffset - 1) };

    case 'SCROLL_DOWN':
      return { ...state, jsonScrollOffset: state.jsonScrollOffset + 1 };

    case 'TOGGLE_SOURCE': {
      if (state.mode.type !== 'browsing') return state;
      if (action.terminalWidth < 120)
        return { ...state, saveError: 'Terminal too narrow for source panel (need 120+ cols)' };
      return { ...state, mode: { ...state.mode, sourceVisible: !state.mode.sourceVisible } };
    }

    case 'OPEN_DIALOG':
      return { ...state, mode: { type: 'dialog', which: action.which } };

    case 'CLOSE_DIALOG':
      return { ...state, mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false } };

    case 'FINALIZE_CONFIRM': {
      if (!state.session) return state;
      const accepted = state.session.components.filter((c) => c.status === 'accepted').length;
      const rejected = state.session.components.filter((c) => c.status === 'rejected').length;
      const excluded = state.session.components.filter((c) => c.status === 'needs-review').length;
      return { ...state, mode: { type: 'finalized', accepted, rejected, excluded } };
    }

    case 'QUIT_CONFIRM':
      return state; // side effect handles exit

    case 'SOURCE_LOADED':
      return { ...state, sourceCodeById: { ...state.sourceCodeById, [action.componentId]: action.code } };

    case 'PREVIEW_START':
      return { ...state, previewLoading: true };

    case 'PREVIEW_SUCCESS': {
      const sortedIds = computeSortedIds(state.session?.components ?? [], action.annotations);
      return {
        ...state,
        previewResponse: action.response,
        previewAnnotations: action.annotations,
        previewLoading: false,
        previewError: null,
        sortedIds,
      };
    }

    case 'PREVIEW_ERROR':
      return { ...state, previewLoading: false, previewError: action.message };

    case 'SAVE_ERROR':
      return { ...state, saveError: action.message };

    case 'CLEAR_ERRORS':
      return { ...state, saveError: null, previewError: null };

    default:
      return state;
  }
}
