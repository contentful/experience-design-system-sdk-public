import { validateComponentSourceInput } from '../../steps/exploration/src/services/source-input-ownership.js';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentInvocationActivity, AgentInvoker, AgentName } from '../../agents/index.js';
import { createLocalCliAgentInvoker } from '../../agents/index.js';
import {
  COMPONENT_SCOPES,
  DETAIL_SCOPES,
  type RendererReferenceInput,
  type ExploreScopeResult,
  type SlotDecision,
  type DerivedSelection,
  type VerifyComponentWork,
  type VerifiedItem,
} from '@contentful/experience-design-system-types';
import {
  openPipelineDb,
  getPipelineDbPath,
  loadCompletedSourceEvidence,
  loadScopeDecisions,
  loadExtractionSourceDiagnostics,
  type SourceEvidenceHandle,
} from '../../persistence/src/session/repositories/db.js';
import {
  beginExplorationRun,
  publishExplorationRun,
  failExplorationRun,
  storeExplorationAttempt,
  storeExplorationReport,
  loadExplorationRun,
  loadExplorationReports,
  loadExplorationAttempts,
  loadAcceptedSlotDecisions,
} from '../../persistence/src/session/repositories/exploration/records.js';
import {
  runExploreStage,
  deriveSelectionFromExploration,
  deriveSlotsFromExploration,
  diffExploration,
  runTierStage,
  buildVerifyWork,
  runVerifyStage,
  runCheckStage,
} from '../../steps/exploration/src/index.js';
import { checkBoundEvidence } from '../../steps/exploration/src/helpers/check-evidence.js';
import { buildExplorationSourceInput } from './helpers/build-source-input.js';
import { buildProposalSources } from './helpers/build-proposal-sources.js';
import { runSourceAnalysis } from '../../source-analysis/run.js';
import { loadExistingExplorationContext } from './helpers/load-existing-context.js';
import { resolveStagePrompts } from './helpers/resolve-stage-prompts.js';
import { loadRendererReference } from './helpers/load-renderer-reference.js';
import { writePhaseArtifact } from './helpers/write-phase-artifact.js';
import { finalizePhaseArtifacts } from './helpers/finalize-phase-artifacts.js';
import { throwIfAborted } from '../../helpers/abort.js';
import { createComponentExplorationCache } from '../../persistence/src/session/repositories/exploration/component-cache.js';
export interface ExplorationProgressEvent {
  phase: 'components' | 'detail';
  stage:
    | 'loading'
    | 'preparing'
    | 'cached'
    | 'exploring'
    | 'checking'
    | 'reconciling'
    | 'verifying'
    | 'finalizing'
    | 'complete';
  done: number;
  total: number;
  scope?: string;
  invocation?: AgentInvocationActivity;
}
export interface RunExplorationSessionRequest {
  /** Reuse compatible component explorer calls across imports; successful calls are always saved. */
  cache?: boolean;
  sessionId: string;
  dbPath?: string;
  agent: AgentName;
  model?: string;
  invoker?: Pick<AgentInvoker, 'invoke'>;
  sourceEvidenceHandle?: SourceEvidenceHandle;
  rendererReference?: RendererReferenceInput;
  outDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  promptOverrides?: string[];
  existingEntitiesPath?: string | null;
  existingContextStatus?: { status: 'absent' | 'available' | 'unavailable' | 'omitted'; reason?: string };
  concurrency?: number;
  operationTimeoutMs?: number;
  promptText?: string;
  promptPath?: string;
  selectedNames?: string[];
  existingComponentsInline?: string;
  existingTokensInline?: string;
  onProgress?: (phase: 'components' | 'detail', scope: string) => void;
  onActivity?: (event: ExplorationProgressEvent) => void;
}
export type RunExplorationSessionResult =
  | { ok: true; runId?: string; skipped?: boolean }
  | { ok: false; runId?: string; error: string };
async function execute(
  request: RunExplorationSessionRequest,
  phase: 'components' | 'detail',
): Promise<RunExplorationSessionResult> {
  throwIfAborted(request.signal);
  const db = openPipelineDb(request.dbPath);
  let runId: string | undefined;
  const scopes = phase === 'components' ? COMPONENT_SCOPES : DETAIL_SCOPES;
  const completedScopes = new Set<string>();
  let activeStage: ExplorationProgressEvent['stage'] = 'loading';
  let activeScope: string | undefined;
  const activity = (
    stage: ExplorationProgressEvent['stage'],
    scope?: string,
    invocation?: AgentInvocationActivity,
  ): void => {
    throwIfAborted(request.signal);
    activeStage = stage;
    activeScope = scope;
    request.onActivity?.({
      phase,
      stage,
      done: completedScopes.size,
      total: scopes.length,
      ...(scope ? { scope } : {}),
      ...(invocation ? { invocation } : {}),
    });
  };
  try {
    if (phase === 'detail' && !loadExplorationRun(db, request.sessionId, 'components'))
      return { ok: true, skipped: true };
    activity('loading');
    const { saved, raw } = await runSourceAnalysis(
      'loadSession',
      {
        dbPath: request.dbPath ?? getPipelineDbPath(),
        sessionId: request.sessionId,
        handle: request.sourceEvidenceHandle,
      },
      { signal: request.signal },
    );
    throwIfAborted(request.signal);
    if (saved.readiness !== 'ready') throw new Error('Completed exploration source evidence unavailable');
    if (new Set(raw.map((component) => component.name)).size !== raw.length)
      throw new Error('Ambiguous duplicate component names are unsupported by the scope gate');
    const human = phase === 'detail' ? loadScopeDecisions(db, request.sessionId) : undefined;
    if (phase === 'detail' && !human) throw new Error('Human-confirmed scope is required for detail exploration');
    const assertScopeCurrent = (): void => {
      if (phase === 'detail' && JSON.stringify(loadScopeDecisions(db, request.sessionId)) !== JSON.stringify(human))
        throw new Error('Selected scope changed during detail exploration');
    };
    const selected = phase === 'detail' ? raw.filter((component) => human!.accepted.includes(component.name)) : raw;
    if (!selected.length) return { ok: true, skipped: true };
    if (
      request.selectedNames &&
      (request.selectedNames.length !== selected.length ||
        request.selectedNames.some((name) => !selected.some((component) => component.name === name)))
    )
      throw new Error('Selected detail scope does not match saved human decisions');
    const run = beginExplorationRun(db, {
      sessionId: request.sessionId,
      phase,
      envelopeId: saved.envelope.envelopeId,
      digest: saved.envelope.digest,
    });
    runId = run.runId;
    const directory = join(
      request.outDir ?? join(dirname(request.dbPath ?? getPipelineDbPath()), 'exploration-artifacts'),
      encodeURIComponent(request.sessionId),
      runId,
      phase,
    );
    let prompts: Awaited<ReturnType<typeof resolveStagePrompts>>;
    let existingContext: Awaited<ReturnType<typeof loadExistingExplorationContext>>;
    let sourceInput: ReturnType<typeof buildExplorationSourceInput>;
    let reference: Awaited<ReturnType<typeof loadRendererReference>>;
    activity('preparing');
    const prepareStarted = Date.now();
    try {
      prompts = await resolveStagePrompts({
        ...request,
        phase,
      });
      existingContext = request.existingContextStatus
        ? {
            ...request.existingContextStatus,
            existingComponentsInline: request.existingComponentsInline,
            existingTokensInline: request.existingTokensInline,
          }
        : await loadExistingExplorationContext(request.existingEntitiesPath, { signal: request.signal });
      sourceInput = await runSourceAnalysis(
        'projectExploration',
        {
          envelope: saved.envelope,
          diagnostics: loadExtractionSourceDiagnostics(db, request.sessionId),
        },
        { signal: request.signal },
      );
      throwIfAborted(request.signal);
      reference = await loadRendererReference(request.rendererReference, { signal: request.signal });
      await writePhaseArtifact(directory, 'reference.json', reference, request.signal);
    } catch (error) {
      storeExplorationAttempt(db, runId, {
        stage: 'prepare',
        operationId: randomUUID(),
        attempt: 1,
        ok: false,
        identity: run,
        startedAt: new Date(prepareStarted).toISOString(),
        durationMs: Date.now() - prepareStarted,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const known = selected.map((component) => ({
      name: component.name,
      source: component.source,
      componentId: component.component_id,
    }));
    const common = {
      onInvocation: (invocation: AgentInvocationActivity) =>
        activity(activeStage, invocation.component ?? activeScope, invocation),
      invoker: request.invoker ?? createLocalCliAgentInvoker(),
      agent: request.agent,
      model: request.model,
      outDir: directory,
      timeoutMs: request.timeoutMs ?? 300000,
      maxAttempts: request.maxAttempts,
      backoffMs: request.backoffMs,
      operationTimeoutMs: request.operationTimeoutMs,
      concurrency: request.concurrency,
      existingComponentsInline: request.existingComponentsInline ?? existingContext.existingComponentsInline,
      existingTokensInline: request.existingTokensInline ?? existingContext.existingTokensInline,
      existingContextStatus: {
        status:
          request.existingComponentsInline !== undefined || request.existingTokensInline !== undefined
            ? ('available' as const)
            : existingContext.status,
        ...(existingContext.reason ? { reason: existingContext.reason } : {}),
      },
      signal: request.signal,
      identity: run,
      sourceInput,
      ...(phase === 'detail' ? { representationProposalSources: buildProposalSources(selected) } : {}),
      onAttempt: (attempt: import('@contentful/experience-design-system-types').AgentCallAttempt) =>
        storeExplorationAttempt(db, runId!, attempt),
    };
    const slotCandidates = selected.map((component) => ({
      component: component.name,
      source: component.source,
      componentId: component.component_id,
      slots: [
        ...new Set([
          ...component.slots.map((slot) => slot.name),
          ...(component.sourceCandidates ?? [])
            .filter((candidate) => candidate.projection.kind === 'slot' || candidate.projection.kind === 'unknown')
            .map((candidate) => candidate.name),
        ]),
      ],
    }));
    const exploration = await runExploreStage({
      ...common,
      ...(phase === 'components'
        ? {
            responseCache: createComponentExplorationCache(db, runId, {
              reuse: request.cache === true,
              onHit: (scope) => activity('cached', scope),
            }),
          }
        : {}),
      scopes,
      onScopeStart: (scope) => activity('exploring', scope),
      rawComponentsInline: JSON.stringify(selected),
      slotCandidates,
      requestedComponents: known,
      rendererReferenceInline: JSON.stringify(reference),
      ...prompts.explore,
      onScopeComplete: async (report) => {
        throwIfAborted(request.signal);
        assertScopeCurrent();
        for (const component of report.companion.components) {
          if (
            !known.some(
              (known) =>
                known.componentId === component.componentId &&
                known.name === component.name &&
                known.source === component.source,
            )
          )
            throw new Error('Exploration report component/source identity mismatch');
          const owner = selected.find((raw) => raw.component_id === component.componentId);
          for (const slot of component.slots ?? [])
            if (slot.sourceInput && owner) validateComponentSourceInput(owner, slot.sourceInput);
        }
        storeExplorationReport(db, runId!, report);
        await writePhaseArtifact(directory, `${report.scope}.json`, report, request.signal);
        completedScopes.add(report.scope);
        activity('exploring', report.scope);
        request.onProgress?.(phase, report.scope);
      },
    });
    if (!exploration.ok) throw new Error(exploration.error);
    throwIfAborted(request.signal);
    const finalize = async (name: string, payload: unknown): Promise<void> => {
      activity('finalizing');
      await finalizePhaseArtifacts({
        directory,
        identity: run,
        artifacts: [
          { name: 'reference.json', payload: reference },
          ...loadExplorationReports(db, request.sessionId, phase).map((report) => ({
            name: `${report.scope}.json`,
            payload: report,
          })),
          { name, payload },
        ],
        loadAttempts: () => loadExplorationAttempts(db, request.sessionId, phase),
        onAttempt: common.onAttempt,
        assertCurrent: () => {
          assertScopeCurrent();
          const current = loadCompletedSourceEvidence(db, request.sessionId, request.sourceEvidenceHandle);
          if (
            loadExplorationRun(db, request.sessionId, phase)?.runId !== runId ||
            current.readiness !== 'ready' ||
            current.envelope.envelopeId !== run.envelopeId ||
            current.envelope.digest !== run.digest
          )
            throw new Error('Stale exploration run or source during finalization');
        },
        signal: request.signal,
        maxAttempts: request.maxAttempts,
        timeoutMs: request.timeoutMs ?? 300000,
        backoffMs: request.backoffMs,
      });
    };
    if (phase === 'components') {
      const scopes: ExploreScopeResult[] = structuredClone(exploration.scopes);
      const selection = deriveSelectionFromExploration(scopes, known);
      const inclusion: DerivedSelection[] = known.map((component) => ({
        ...component,
        ...(selection.find((decision) => decision.name === component.name && decision.source === component.source) ?? {
          componentKey: JSON.stringify([component.name, component.source]),
          reason: 'No eligible inclusion evidence.',
          votes: { accepted: 0, rejected: 0 },
          dissent: [],
          disputed: true,
        }),
      }));
      const allowed = new Set(
        inclusion.filter((decision) => decision.decision === 'accepted').map((decision) => decision.name),
      );
      const proposed = deriveSlotsFromExploration(scopes, known, allowed);
      const proofs: VerifyComponentWork[] = [];
      const proofSlots = new Map<
        string,
        Array<import('@contentful/experience-design-system-types').ExploreSlotEvidence>
      >();
      for (const report of scopes)
        for (const component of report.companion.components)
          for (const slot of component.slots ?? []) {
            const rawComponent = selected.find((raw) => raw.component_id === component.componentId);
            if (slot.sourceInput) {
              if (!rawComponent) throw new Error('Source input component unavailable');
              validateComponentSourceInput(rawComponent, slot.sourceInput);
            }
            const inputName = slot.sourceInput?.inputName ?? slot.name;
            const fact = rawComponent?.sourceCandidates?.find((candidate) => candidate.name === inputName)?.facts;
            if (fact?.certainty === 'certain' && fact.domain.openness === 'open') {
              slot.allowedComponents = [];
              continue;
            }
            if (!slot.restriction?.applicable || !slot.allowedComponents?.length) continue;
            const work: VerifyComponentWork = {
              component: component.name,
              source: component.source,
              callSites: [],
              items: [],
            };
            if (!checkBoundEvidence(slot.restriction.evidence, work, sourceInput)) continue;
            const id = JSON.stringify([
              component.componentId,
              slot.name,
              slot.restriction.kind,
              slot.allowedComponents,
            ]);
            const slots = proofSlots.get(id) ?? [];
            slots.push(slot);
            proofSlots.set(id, slots);
            if (slots.length > 1) continue;
            work.items.push({
              itemId: id,
              kind: 'factual',
              hypothesis: `Check that the declared/enforced restriction applies to this exact input and its returned output conditions; unrelated predicates or compatible broad contracts are not support. ${JSON.stringify({ sourceInput: slot.sourceInput ?? null, inputName, componentDeclarationId: rawComponent?.componentFacts?.sourceObservations?.componentDeclarationId ?? null, inputOutput: rawComponent?.componentFacts?.sourceObservations?.inputOutput ?? null })}`,
              claims: [
                {
                  id,
                  path: id,
                  scope: 'slot',
                  member: slot.name,
                  field: 'allowedComponents',
                  valuesByScope: { [report.scope]: slot.allowedComponents },
                },
              ],
            });
            proofs.push(work);
          }
      if (proofs.length) {
        const verified: VerifiedItem[] = proofs.map((work) => {
          const slot = proofSlots.get(work.items[0]!.itemId)![0]!;
          return {
            itemId: work.items[0]!.itemId,
            component: work.component,
            source: work.source,
            outcome: 'confirmed',
            resolved: [{ path: work.items[0]!.itemId, value: slot.allowedComponents }],
            evidence: slot.restriction!.evidence,
            reason: 'Independent source restriction requires support check.',
          };
        });
        activity('checking');
        const checked = await runCheckStage({ ...common, ...prompts.check, components: proofs, verified });
        if (!checked.ok) throw new Error(checked.error);
        for (const item of checked.items)
          if (item.outcome !== 'conflicting')
            for (const slot of proofSlots.get(item.itemId) ?? []) slot.restriction!.supported = true;
      }
      const derived = deriveSlotsFromExploration(scopes, known, allowed);
      const slots: SlotDecision[] = [...derived.decisions];
      for (const component of slotCandidates)
        for (const name of component.slots)
          if (!slots.some((slot) => slot.componentId === component.componentId && slot.slot === name))
            slots.push({
              name: component.component,
              source: component.source,
              componentId: component.componentId,
              slot: name,
              state: 'unresolved',
              allowedComponents: [],
              evidence: [],
              coverage: 0,
              realVotes: 0,
            });
      for (const slot of slots) {
        const rawComponent = selected.find((component) => component.component_id === slot.componentId);
        const candidate = rawComponent?.sourceCandidates?.find(
          (candidate) => candidate.name === (slot.sourceInput?.inputName ?? slot.slot),
        );
        const fact = candidate?.facts;
        if (
          fact?.certainty === 'certain' &&
          fact.declarations.some((location) => location.binding === 'verified') &&
          fact.declaredRequired !== null
        )
          slot.required = fact.declaredRequired;
        const description = rawComponent?.slots.find((raw) => raw.name === slot.slot)?.description;
        if (description) slot.description = description;
        slot.provenance = 'source-consensus';
        slot.disputes = [...proposed.disputes, ...derived.disputes].filter(
          (dispute) => dispute.component === slot.name && dispute.source === slot.source && dispute.slot === slot.slot,
        );
      }
      await finalize('accepted.json', { inclusion, slots, disputes: [...proposed.disputes, ...derived.disputes] });
      throwIfAborted(request.signal);
      publishExplorationRun(db, runId, { inclusion, slots });
    } else {
      activity('reconciling');
      const components = loadExplorationReports(db, request.sessionId, 'components').map((report) => ({
        ...report,
        companion: {
          ...report.companion,
          components: report.companion.components.filter((component) =>
            known.some((known) => known.componentId === component.componentId),
          ),
        },
      }));
      const diff = diffExploration([...components, ...exploration.scopes], known);
      const tier = await runTierStage({ ...common, ...prompts.tier, disagreements: diff.disagreements });
      if (!tier.ok) throw new Error(tier.error);
      const work = buildVerifyWork({ diff, hypotheses: tier.hypotheses, sourceInput });
      activity('verifying');
      const verification = await runVerifyStage({ ...common, ...prompts.verify, components: work });
      if (!verification.ok) throw new Error(verification.error);
      activity('checking');
      const check = await runCheckStage({
        ...common,
        ...prompts.check,
        components: work,
        verified: verification.items,
      });
      if (!check.ok) throw new Error(check.error);
      const detail = {
        diff,
        hypotheses: tier.hypotheses,
        verified: check.items,
        checks: check.checks,
        recordOnly: true,
      };
      await finalize('detail.json', detail);
      throwIfAborted(request.signal);
      assertScopeCurrent();
      publishExplorationRun(db, runId, { detail });
    }
    activity('complete');
    return { ok: true, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) failExplorationRun(db, runId, message, request.signal?.aborted);
    if (request.signal?.aborted) throwIfAborted(request.signal);
    return { ok: false, ...(runId ? { runId } : {}), error: message };
  } finally {
    db.close();
  }
}
export function runExplorationComponentsSession(
  request: RunExplorationSessionRequest,
): Promise<RunExplorationSessionResult> {
  return execute(request, 'components');
}
export function runExplorationDetailSession(
  request: RunExplorationSessionRequest,
): Promise<RunExplorationSessionResult> {
  return execute(request, 'detail');
}
export function hasExplorationSession(sessionId: string): boolean {
  const db = openPipelineDb();
  try {
    return loadAcceptedSlotDecisions(db, sessionId) !== undefined;
  } finally {
    db.close();
  }
}
