import React from 'react';
import { Box } from 'ink';
import { parseCDFComponents } from '@contentful/experience-design-system-types';
import { ErrorStep, GateStep, RunningStep } from '../../../shared/index.js';
import { PreviewValidationErrorScreen } from '../../preview-validation-error/screen.js';
import { GenerateReviewStep } from '../../09-review/generate-review-step.js';
import { CustomPromptBanner } from '../components/CustomPromptBanner.js';
import { DoneStep } from '../screens/DoneStep.js';
import { PathPrompt } from '../screens/PathPrompt.js';
import { PushingStep } from '../screens/PushingStep.js';
import { WizardPreviewStep } from '../screens/WizardPreviewStep.js';
import { fileSummaryLabel, producedOf } from '../support/produced.js';
import { buildRunTeaserLine } from '../support/run-teaser.js';
import type { FlowController } from './controller.js';
import type { FlowState } from './types.js';

interface FlowScreenProps {
  state: FlowState;
  controller: FlowController;
  livePreview?: boolean;
  generatePromptPath?: string;
  /** Leaves the import with the exit code the wizard would have exited with. */
  onExit: (exitCode: number) => void;
}

/** Whether the preview gate offers "[e] Edit definitions": only when the document has components to edit. */
function canEditFromPreview(cdf: FlowState['cdf']): boolean {
  if (!cdf) return false;
  return parseCDFComponents(cdf as unknown as Record<string, unknown>).components.length > 0;
}

export function FlowScreen({
  state,
  controller,
  livePreview = true,
  generatePromptPath,
  onExit,
}: FlowScreenProps): React.ReactElement {
  const produced = producedOf(state);
  const quit = (): void => onExit(0);

  const content = ((): React.ReactElement | null => {
    switch (state.step) {
      case 'final-review':
        return (
          <GenerateReviewStep
            extractSessionId={state.extractSessionId}
            tokenSessionId={state.tokenSessionId}
            livePreview={livePreview}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            cmaToken={state.cmaToken}
            host={state.host}
            tokensPath={state.tokensPath}
            initialFinalizeError={state.finalizeErrorBanner}
            onFinalize={controller.finalize}
            onQuit={quit}
          />
        );

      case 'previewing':
        return <RunningStep step="push" description="Computing diff against your Contentful space..." />;

      case 'preview-gate':
        if (!state.serverPreview) return null;
        return (
          <WizardPreviewStep
            preview={state.serverPreview}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            onConfirm={controller.confirmPreview}
            // Editing would dead-end on "No generated definitions found" when the document is empty (delete-all).
            {...(canEditFromPreview(state.cdf) ? { onEdit: controller.editDefinitions } : {})}
            onQuit={quit}
          />
        );

      case 'pushing':
        return <PushingStep progress={state.pushProgress} produced={produced} />;

      case 'path-prompt':
        return (
          <PathPrompt
            defaultPath={state.outDir}
            onSubmit={(submitted) => void controller.submitPath(submitted)}
            onCancel={quit}
          />
        );

      case 'printing':
        return <RunningStep step="push" description="Writing output files to disk..." />;

      case 'print-gate': {
        const teaser = buildRunTeaserLine(state.lastRunId);
        return (
          <GateStep
            step="push"
            message="Files saved"
            summary={state.componentsPath ? `${fileSummaryLabel(produced)} → ${state.componentsPath}` : undefined}
            context={
              teaser
                ? `Your files are saved to disk. ${teaser}`
                : "Your files are saved to disk. Run `experiences import` again when you're ready to push to Contentful."
            }
            continueLabel="Exit"
            onContinue={quit}
            onQuit={quit}
          />
        );
      }

      case 'done': {
        const totalFailed = state.pushResult.componentTypes.failed + state.pushResult.designTokens.failed;
        return (
          <DoneStep
            componentTypes={state.pushResult.componentTypes}
            designTokens={state.pushResult.designTokens}
            summary={state.pushResult.summary}
            failures={state.pushResult.failures}
            spaceId={state.spaceId}
            environmentId={state.environmentId}
            host={state.host}
            produced={produced}
            credentialsSkipped={state.credentialsSkipped}
            onExit={() => onExit(totalFailed > 0 ? 1 : 0)}
          />
        );
      }

      case 'preview-validation-error':
        return (
          <PreviewValidationErrorScreen
            errors={state.previewValidationErrors}
            missingNames={state.previewValidationMissingNames}
            onEdit={controller.editDefinitions}
            onSkip={() => void controller.skipValidationErrors()}
            onQuit={quit}
          />
        );

      case 'error':
        return (
          <ErrorStep
            stepName={state.errorStep}
            message={state.errorMessage}
            onExit={() => onExit(1)}
            onAcknowledgeBreakingChanges={
              state.errorAllowBreakingChangeAcknowledgment && state.cdf
                ? controller.acknowledgeBreakingChanges
                : undefined
            }
          />
        );
    }
  })();

  return (
    <Box flexDirection="column">
      <CustomPromptBanner generatePromptPath={generatePromptPath} />
      {content}
    </Box>
  );
}
