import { useEffect, useRef } from 'react';
import { readFile } from 'node:fs/promises';
import type { AppState, AppAction } from '../state.js';
import type { ReviewComponentStatus, ReviewSessionSnapshot, PreviewAnnotation } from '../../types.js';
import { openPipelineDb, storeRawComponents, loadCDFComponents } from '../../../../session/db.js';
import { ImportApiClient } from '../../../../apply/api-client.js';
import { readTokensFromPath } from '../../../../apply/manifest.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

type Services = {
  sessionId: string;
  saveState: (session: ReviewSessionSnapshot) => Promise<void>;
  appendEvent: (event: { type: string; payload: Record<string, unknown> }) => Promise<void>;
};

type Dispatch = (action: AppAction) => void;

/**
 * All async side effects in one place.
 * Detects transitions by comparing state to prevState — no pending* counter signals needed.
 */
export function useSideEffects(state: AppState, dispatch: Dispatch, services: Services): void {
  const prevRef = useRef<AppState>(state);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;

    // ── Session persistence: save whenever session components change ──────
    if (state.session && state.paths && prev.session?.components !== state.session.components) {
      void services.saveState(state.session);
    }

    // ── Draft persist: mode just left editing ─────────────────────────────
    if (prev.mode.type === 'editing' && state.mode.type !== 'editing') {
      const { componentId } = prev.mode;
      const draft = state.draftsByComponentId[componentId];
      if (draft && state.session && state.paths) {
        void persistDraft(componentId, draft, state, dispatch, services);
      }
    }

    // ── Finalize: mode just became finalized ──────────────────────────────
    if (prev.mode.type !== 'finalized' && state.mode.type === 'finalized') {
      if (state.session && state.paths) {
        void persistFinalize(state, dispatch, services);
      }
    }

    // ── Preview refresh: session components changed ───────────────────────
    if (state.session?.components !== prev.session?.components && state.session) {
      schedulePreviewRefresh(state, dispatch, services.sessionId);
    }
  });

  // ── Source code lazy loading ──────────────────────────────────────────────
  useEffect(() => {
    if (!state.selectedId || !state.session) return;
    if (state.sourceCodeById[state.selectedId] !== undefined) return;
    const component = state.session.components.find((c) => c.id === state.selectedId);
    if (!component) return;
    const id = state.selectedId;
    readFile(component.resolvedSourcePath, 'utf8')
      .then((code) => dispatch({ type: 'SOURCE_LOADED', componentId: id, code }))
      .catch(() => dispatch({ type: 'SOURCE_LOADED', componentId: id, code: '' }));
  }, [state.selectedId]);

  // ── SIGINT ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (Object.keys(state.draftsByComponentId).length > 0) {
        dispatch({ type: 'OPEN_DIALOG', which: 'quit' });
      } else {
        process.exit(1);
      }
    };
    process.on('SIGINT', handler);
    return () => {
      process.off('SIGINT', handler);
    };
  }, [state.draftsByComponentId]);

  // ── QUIT_CONFIRM: exit process ────────────────────────────────────────────
  useEffect(() => {
    if (state.mode.type !== 'dialog') return;
    // QUIT_CONFIRM keeps mode as-is in the reducer; we detect it differently:
    // QuitDialog's confirm button directly calls process.exit in App.tsx
  }, []);

  // ── Auto-clear errors ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!state.saveError) return;
    const t = setTimeout(() => dispatch({ type: 'CLEAR_ERRORS' }), 3000);
    return () => clearTimeout(t);
  }, [state.saveError]);

  // ── Seed preview from env (non-live mode) ─────────────────────────────────
  useEffect(() => {
    if (!state.session || state.previewResponse) return;
    const raw = process.env['EDS_PREVIEW_COUNTS'];
    if (!raw) return;
    try {
      const counts = JSON.parse(raw) as Record<string, number>;
      const make = (n: number) => Array(n).fill({}) as unknown[];
      dispatch({
        type: 'PREVIEW_SUCCESS',
        response: {
          components: {
            new: make(counts.compNew ?? 0),
            changed: make(counts.compChanged ?? 0),
            removed: make(counts.compRemoved ?? 0),
            unchanged: make(counts.compUnchanged ?? 0),
          },
          tokens: {
            new: make(counts.tokNew ?? 0),
            changed: make(counts.tokChanged ?? 0),
            removed: make(counts.tokRemoved ?? 0),
            unchanged: make(counts.tokUnchanged ?? 0),
          },
        } as unknown as ServerPreviewResponse,
        annotations: {},
      });
    } catch {}
  }, [state.session]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function persistDraft(
  componentId: string,
  draft: string,
  state: AppState,
  dispatch: Dispatch,
  services: Services,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(draft) as Record<string, any>;
    const component = state.session!.components.find((c) => c.id === componentId);
    const currentStatus = component?.status;
    const newStatus: ReviewComponentStatus =
      currentStatus === 'needs-review' ? 'reviewed' : (currentStatus ?? 'reviewed');

    const updatedComponents = state.session!.components.map((c) =>
      c.id === componentId ? { ...c, editedProposal: parsed as typeof c.editedProposal, status: newStatus } : c,
    );

    await services.saveState({ ...state.session!, components: updatedComponents });
    await services.appendEvent({ type: 'draft_saved', payload: { componentId } });

    const db = openPipelineDb();
    try {
      storeRawComponents(
        db,
        services.sessionId,
        updatedComponents.map((c) => c.editedProposal),
        {
          status: 'generated',
          preserveCDF: true,
        },
      );
    } finally {
      db.close();
    }

    dispatch({ type: 'DRAFT_PERSIST_DONE', componentId, updatedComponents });
  } catch {
    dispatch({ type: 'DRAFT_PERSIST_DONE', componentId, updatedComponents: state.session!.components });
  }
}

async function persistFinalize(state: AppState, dispatch: Dispatch, services: Services): Promise<void> {
  if (state.mode.type !== 'finalized') return;
  const { accepted, rejected, excluded } = state.mode;
  try {
    await services.appendEvent({ type: 'finalized', payload: { accepted, rejected, excluded } });

    const acceptedNames = new Set(state.session!.components.filter((c) => c.status === 'accepted').map((c) => c.name));
    const db = openPipelineDb();
    try {
      storeRawComponents(
        db,
        services.sessionId,
        state.session!.components.map((c) => c.editedProposal),
        { status: 'extracted', preserveCDF: true },
      );
      if (acceptedNames.size > 0) {
        db.prepare(
          `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${[...acceptedNames].map(() => '?').join(',')})`,
        ).run(services.sessionId, ...acceptedNames);
      }
    } finally {
      db.close();
    }

    process.stdout.write(
      JSON.stringify(
        { status: 'finalized', sessionDir: state.paths!.sessionDir, accepted, rejected, excluded },
        null,
        2,
      ) + '\n',
    );
  } catch (err) {
    dispatch({ type: 'SAVE_ERROR', message: String(err) });
  }
}

const previewTimers = new Map<string, ReturnType<typeof setTimeout>>();

function schedulePreviewRefresh(state: AppState, dispatch: Dispatch, sessionId: string): void {
  const existing = previewTimers.get(sessionId);
  if (existing) clearTimeout(existing);

  previewTimers.set(
    sessionId,
    setTimeout(() => {
      previewTimers.delete(sessionId);

      // Sync session to DB
      const db = openPipelineDb();
      try {
        db.prepare(`UPDATE raw_components SET status = 'extracted' WHERE session_id = ?`).run(sessionId);
        const acceptedNames = state
          .session!.components.filter((c) => c.status === 'accepted' || c.status === 'reviewed')
          .map((c) => c.name);
        if (acceptedNames.length > 0) {
          db.prepare(
            `UPDATE raw_components SET status = 'generated' WHERE session_id = ? AND name IN (${acceptedNames.map(() => '?').join(',')})`,
          ).run(sessionId, ...acceptedNames);
        }
      } finally {
        db.close();
      }

      const cmaToken = process.env['EDS_CMA_TOKEN'];
      const spaceId = process.env['EDS_SPACE_ID'];
      const environmentId = process.env['EDS_ENVIRONMENT_ID'];
      const tokensPath = process.env['EDS_TOKENS_PATH'];
      if (!cmaToken || !spaceId || !environmentId) return;

      dispatch({ type: 'PREVIEW_START' });
      void (async () => {
        try {
          const pdb = openPipelineDb();
          let components: Array<{ key: string; entry: unknown }> = [];
          try {
            components = loadCDFComponents(pdb, sessionId);
          } finally {
            pdb.close();
          }

          let tokens: unknown[] = [];
          if (tokensPath) tokens = await readTokensFromPath('tokens', tokensPath);

          const manifest = buildManifest(
            components as Parameters<typeof buildManifest>[0],
            tokens as Parameters<typeof buildManifest>[1],
          );
          if (!manifest.componentsManifest) manifest.componentsManifest = {};

          const client = new ImportApiClient({ cmaToken, spaceId, environmentId });
          const preview: ServerPreviewResponse = await client.previewImport(manifest);

          const annotations: Record<string, PreviewAnnotation> = {};
          for (const item of preview.components.new) {
            const name = ((item as unknown as Record<string, unknown>).name as string) ?? '';
            if (name) annotations[name] = 'new';
          }
          for (const item of preview.components.removed) annotations[item.name] = 'removed';
          for (const item of preview.components.changed) {
            annotations[item.current.name] =
              item.changeClassification?.classification === 'breaking' ? 'breaking' : 'changed';
          }

          dispatch({ type: 'PREVIEW_SUCCESS', response: preview, annotations });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dispatch({ type: 'PREVIEW_ERROR', message: msg.includes('token') ? 'Preview request failed' : msg });
        }
      })();
    }, 500),
  );
}
