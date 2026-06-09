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
// Exactly one mode is active at all times. The mode determines what keyboard
// input means — no guards scattered across components needed.

export type AppMode =
  | { type: 'browsing'; sidebarFocused: boolean; sourceVisible: boolean }
  | { type: 'editing'; componentId: string }
  | { type: 'dialog'; which: 'help' | 'finalize' | 'quit' }
  | { type: 'finalized'; accepted: number; rejected: number; excluded: number };

// ── State ─────────────────────────────────────────────────────────────────────

export type AppState = {
  mode: AppMode;
  session: ReviewSessionSnapshot | null;
  paths: { sessionDir: string; statePath: string; eventsPath: string } | null;
  selectedId: string | null;
  sortedIds: string[]; // derived from session; recomputed in reducer on session change
  sidebarScrollOffset: number;
  jsonScrollOffset: number;
  draftsByComponentId: Record<string, string>;
  sourceCodeById: Record<string, string>;
  previewAnnotations: Record<string, PreviewAnnotation>;
  previewResponse: ServerPreviewResponse | null;
  previewLoading: boolean;
  previewError: string | null;
  saveError: string | null;
  // Signals for side-effect hooks to watch
  pendingDraftSave: string | null; // componentId whose draft needs persisting
  pendingPreviewRefresh: number; // increment to trigger a debounced preview refresh
  pendingSessionSave: number; // increment to trigger saveState (after status changes)
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
  pendingDraftSave: null,
  pendingPreviewRefresh: 0,
  pendingSessionSave: 0,
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
  | { type: 'DRAFT_CHANGE'; value: string }
  | { type: 'DRAFT_SAVE' }
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

// ── Derived sort order ────────────────────────────────────────────────────────

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
      annotation: annotations[c.name],
    }))
    .sort((a, b) => {
      const aFlagged = a.needsReview && a.status === 'needs-review' ? 0 : 1;
      const bFlagged = b.needsReview && b.status === 'needs-review' ? 0 : 1;
      if (aFlagged !== bFlagged) return aFlagged - bFlagged;
      return a.conf - b.conf;
    })
    .map((c) => c.id);
}

// ── Helper ────────────────────────────────────────────────────────────────────

function updateComponentStatus(state: AppState, newStatus: ReviewComponentStatus): AppState {
  if (!state.session || !state.selectedId) return state;
  const components = state.session.components.map((c) => (c.id === state.selectedId ? { ...c, status: newStatus } : c));
  return {
    ...state,
    session: { ...state.session, components },
    pendingPreviewRefresh: state.pendingPreviewRefresh + 1,
    pendingSessionSave: state.pendingSessionSave + 1,
  };
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SESSION_LOADED': {
      const sortedIds = computeSortedIds(action.session.components, state.previewAnnotations);
      const selectedId = sortedIds[0] ?? null;
      return {
        ...state,
        session: action.session,
        paths: action.paths,
        sortedIds,
        selectedId,
      };
    }

    case 'SELECT':
      return { ...state, selectedId: action.id, jsonScrollOffset: 0 };

    case 'SIDEBAR_UP': {
      if (!state.session || !state.selectedId) return state;
      const idx = state.sortedIds.indexOf(state.selectedId);
      if (idx <= 0) return state;
      const newIdx = idx - 1;
      return {
        ...state,
        selectedId: state.sortedIds[newIdx]!,
        jsonScrollOffset: 0,
        sidebarScrollOffset: computeScrollOffset(newIdx, state.sidebarScrollOffset, action.visibleCount),
      };
    }

    case 'SIDEBAR_DOWN': {
      if (!state.session || !state.selectedId) return state;
      const idx = state.sortedIds.indexOf(state.selectedId);
      if (idx >= state.sortedIds.length - 1) return state;
      const newIdx = idx + 1;
      return {
        ...state,
        selectedId: state.sortedIds[newIdx]!,
        jsonScrollOffset: 0,
        sidebarScrollOffset: computeScrollOffset(newIdx, state.sidebarScrollOffset, action.visibleCount),
      };
    }

    case 'ACCEPT':
      return updateComponentStatus(state, 'accepted');

    case 'REJECT':
      return updateComponentStatus(state, 'rejected');

    case 'APPROVE_ALL': {
      if (!state.session) return state;
      const components = state.session.components.map((c) =>
        c.status === 'needs-review' ? { ...c, status: 'accepted' as ReviewComponentStatus } : c,
      );
      return {
        ...state,
        session: { ...state.session, components },
        pendingPreviewRefresh: state.pendingPreviewRefresh + 1,
        pendingSessionSave: state.pendingSessionSave + 1,
      };
    }

    case 'ENTER_EDIT': {
      if (state.mode.type !== 'browsing' || !state.selectedId || !state.session) return state;
      const component = state.session.components.find((c) => c.id === state.selectedId);
      if (!component) return state;
      const existingDraft = state.draftsByComponentId[state.selectedId];
      const draft = existingDraft ?? JSON.stringify(stripScoringFields(component.editedProposal), null, 2);
      return {
        ...state,
        mode: { type: 'editing', componentId: state.selectedId },
        draftsByComponentId: { ...state.draftsByComponentId, [state.selectedId]: draft },
      };
    }

    case 'DRAFT_CHANGE': {
      if (state.mode.type !== 'editing') return state;
      return {
        ...state,
        draftsByComponentId: { ...state.draftsByComponentId, [state.mode.componentId]: action.value },
      };
    }

    case 'DRAFT_SAVE': {
      if (state.mode.type !== 'editing') return state;
      const { componentId } = state.mode;
      return {
        ...state,
        mode: {
          type: 'browsing',
          sidebarFocused: true,
          sourceVisible: (state.mode as never as { sourceVisible?: boolean }).sourceVisible ?? false,
        },
        pendingDraftSave: componentId,
      };
    }

    case 'DRAFT_DISCARD': {
      if (state.mode.type !== 'editing') return state;
      const { componentId } = state.mode;
      const { [componentId]: _removed, ...remainingDrafts } = state.draftsByComponentId;
      return {
        ...state,
        mode: { type: 'browsing', sidebarFocused: true, sourceVisible: false },
        draftsByComponentId: remainingDrafts,
      };
    }

    case 'DRAFT_PERSIST_DONE': {
      const { componentId, updatedComponents } = action;
      const { [componentId]: _removed, ...remainingDrafts } = state.draftsByComponentId;
      return {
        ...state,
        session: state.session ? { ...state.session, components: updatedComponents } : state.session,
        draftsByComponentId: remainingDrafts,
        pendingDraftSave: null,
        pendingPreviewRefresh: state.pendingPreviewRefresh + 1,
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
      // Actual process.exit happens in the side-effect hook watching this
      return state;

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
