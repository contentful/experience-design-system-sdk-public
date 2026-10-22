import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as z from 'zod/mini';
import {
  evaluateComponentReadiness,
  getPipelineDbPath,
  loadAcceptedSlotDecisions,
  loadCompletedSourceEvidence,
  loadExplorationRecord,
  loadRawComponents,
  loadScopeDecisions,
  openPipelineDb,
  type ScopeDecisions,
} from '@contentful/experience-design-system-backend-pipeline';
import { parseHandoff, type ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput } from './steps/06-extraction/types.js';

export const DEBUG_RESUME_STEPS = ['scope', 'details', 'generation', 'tokens', 'review'] as const;
export type DebugResumeStep = (typeof DEBUG_RESUME_STEPS)[number];

const CheckpointSchema = z.object({
  version: z.literal(1),
  projectPath: z.string().check(z.minLength(1)),
  rawTokensPath: z.string(),
  agent: z.string().check(z.minLength(1)),
  agentModel: z.optional(z.string()),
  promptOverrides: z.array(z.string()),
  extraction: z.custom<ExtractionHandoff>(
    (value) =>
      value !== undefined &&
      parseHandoff(JSON.stringify({ credentialsSkipped: true, tokens: { strategy: 'reuse' }, extraction: value })).ok,
  ),
});
export type DebugImportCheckpoint = z.infer<typeof CheckpointSchema>;

export interface DebugResumeState {
  checkpoint: DebugImportCheckpoint;
  decisions?: ScopeDecisions;
  detailComplete: boolean;
  generationComplete: boolean;
  tokenMappingComplete: boolean;
}

export function debugCheckpointDirectory(sessionId: string): string {
  return join(dirname(getPipelineDbPath()), 'debug-resume', encodeURIComponent(sessionId));
}

async function saveJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

export async function saveDebugImportCheckpoint(input: ExtractionInput, extraction: ExtractionHandoff): Promise<void> {
  const checkpoint: DebugImportCheckpoint = {
    version: 1,
    projectPath: input.projectPath,
    rawTokensPath: input.rawTokensPath,
    agent: input.agent,
    ...(input.agentModel ? { agentModel: input.agentModel } : {}),
    promptOverrides: input.promptOverrides,
    extraction,
  };
  await saveJson(join(debugCheckpointDirectory(extraction.sessionId), 'checkpoint.json'), checkpoint);
}

export async function saveDebugTokenMappingComplete(sessionId: string, detailRunId: string | undefined): Promise<void> {
  await saveJson(join(debugCheckpointDirectory(sessionId), 'token-mapping.json'), { detailRunId });
}

/** Explicit debugging reopens saved evidence; it does not compare it with current disk or prompt contents. */
export async function loadDebugResume(
  session: string,
  fallback?: { outDir: string; agent: string; agentModel?: string; promptOverrides: string[] },
): Promise<DebugResumeState> {
  const db = openPipelineDb();
  try {
    const latest =
      session === 'latest'
        ? (db
            .prepare(
              "SELECT session_id FROM steps WHERE command='analyze extract' AND status='complete' ORDER BY id DESC LIMIT 1",
            )
            .get() as { session_id: string } | undefined)
        : undefined;
    const sessionId = session === 'latest' ? latest?.session_id : session;
    if (!sessionId) throw new Error('No saved extraction session is available.');
    const evidence = loadCompletedSourceEvidence(db, sessionId);
    if (evidence.readiness !== 'ready') throw new Error('Completed source snapshot is unavailable for this session.');
    if (loadAcceptedSlotDecisions(db, sessionId) === undefined)
      throw new Error('Component exploration did not finish for this session.');
    const path = join(debugCheckpointDirectory(sessionId), 'checkpoint.json');
    let checkpoint: DebugImportCheckpoint;
    if (existsSync(path)) {
      checkpoint = CheckpointSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } else {
      if (!fallback)
        throw new Error(
          'This older session has no debug checkpoint; supply --debug-output with its original import output folder.',
        );
      const step = db
        .prepare(
          "SELECT inputs FROM steps WHERE session_id=? AND command='analyze extract' AND status='complete' ORDER BY id DESC LIMIT 1",
        )
        .get(sessionId) as { inputs: string } | undefined;
      const project: unknown = step ? JSON.parse(step.inputs).project : undefined;
      if (typeof project !== 'string' || !project) throw new Error('Saved project path is unavailable.');
      const outDir = resolve(fallback.outDir);
      if (!existsSync(outDir)) throw new Error('Original debug output folder does not exist.');
      const tokensPath = join(outDir, 'tokens.json');
      const existingEntitiesPath = join(outDir, '.existing-entities.json');
      checkpoint = {
        version: 1,
        projectPath: project,
        rawTokensPath: '',
        agent: fallback.agent,
        ...(fallback.agentModel ? { agentModel: fallback.agentModel } : {}),
        promptOverrides: fallback.promptOverrides,
        extraction: {
          sessionId,
          outDir,
          tokensPath: existsSync(tokensPath) ? tokensPath : '',
          tokenSessionId: null,
          tokenCount: 0,
          existingEntitiesPath: existsSync(existingEntitiesPath) ? existingEntitiesPath : null,
          existingEntitiesStatus: existsSync(existingEntitiesPath) ? 'complete' : 'idle',
          compositionPhase: 'done',
        },
      };
      await saveJson(path, checkpoint);
    }
    if (checkpoint.extraction.sessionId !== sessionId) throw new Error('Debug checkpoint session identity mismatch.');
    const decisions = loadScopeDecisions(db, sessionId);
    const detail = loadExplorationRecord(db, sessionId, 'detail', 'detail');
    const accepted = new Set(decisions?.accepted ?? []);
    const components = loadRawComponents(db, sessionId).filter((component) => accepted.has(component.name));
    const generationComplete =
      !!decisions &&
      components.length === accepted.size &&
      components.every(
        (component) => evaluateComponentReadiness(db, sessionId, component.component_id).definition.ready,
      );
    let tokenMappingComplete = false;
    const tokenMarker = join(debugCheckpointDirectory(sessionId), 'token-mapping.json');
    if (existsSync(tokenMarker)) {
      const marker: unknown = JSON.parse(await readFile(tokenMarker, 'utf8'));
      const current = db
        .prepare("SELECT run_id FROM exploration_current WHERE session_id=? AND phase='detail'")
        .get(sessionId) as { run_id: string } | undefined;
      tokenMappingComplete =
        !!marker &&
        typeof marker === 'object' &&
        'detailRunId' in marker &&
        marker.detailRunId === current?.run_id &&
        generationComplete;
    }
    return { checkpoint, decisions, detailComplete: !!detail, generationComplete, tokenMappingComplete };
  } finally {
    db.close();
  }
}

export function assertDebugResumeStep(state: DebugResumeState, step: DebugResumeStep): void {
  if (step !== 'scope' && !state.decisions) throw new Error('Confirm component scope before resuming this step.');
  if (['generation', 'tokens', 'review'].includes(step) && !state.detailComplete)
    throw new Error('Property and slot reviews did not finish; resume from details.');
  if (['tokens', 'review'].includes(step) && !state.generationComplete)
    throw new Error('Some definitions are held or incomplete; resume from generation.');
  if (step === 'review' && !state.tokenMappingComplete)
    throw new Error('Token mapping has not completed; resume from tokens.');
}
