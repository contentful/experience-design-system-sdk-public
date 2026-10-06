import { createElement } from 'react';
import { GoodbyeBoundary, renderWithGoodbye } from '../../tui/render-with-goodbye.js';
import { buildCDF } from '@contentful/experience-design-system-types';
import { ApiError } from '../api-client.js';
import { formatApiError } from '../../lib/error-parser.js';
import { getInteractiveTerminalSupport } from '../../lib/terminal-capabilities.js';
import {
  bindAnalyticsSessionId,
  exitWithAnalytics,
  failureFromApiError,
  recordContentfulContext,
} from '../../analytics/index.js';
import type { CommandFailure } from '../../analytics/index.js';

import { isEmptyPreview } from '../preview-utils.js';
import { ServerPreviewConfirm } from '../tui/ServerApplyView.js';
import { resolveApplyInputsOrDie } from '../services/resolve-apply-inputs.js';
import { applyNonInteractive } from '../services/apply-non-interactive.js';
import { applyInteractive } from '../services/apply-interactive.js';
import { assertNoSlotCycles, assertNoUnresolvedSlotReferences } from '../helpers/slot-validation.js';
import { toCDFTokens } from '../helpers/read-token-files.js';
import { hasBreakingChangesWithImpact } from '../helpers/has-breaking-changes.js';
import { buildPreviewOutput } from '../helpers/build-apply-output.js';

async function die(message: string, fields: CommandFailure = {}): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1, fields);
}

export async function runApply(file: string): Promise<void> {
  const isTTY = getInteractiveTerminalSupport().supported;

  const inputs = await resolveApplyInputsOrDie(file);
  const { components, tokens, client, spaceId, environmentId, host } = inputs;

  await bindAnalyticsSessionId(undefined, {
    space_key: spaceId,
    environment_key: environmentId,
  });

  await assertNoSlotCycles(components);
  await assertNoUnresolvedSlotReferences(components);

  try {
    await client.validateToken();
  } catch (e) {
    if (e instanceof ApiError) return await die(`Error: ${formatApiError(e)}`, failureFromApiError(e));
    throw e;
  }

  const cdf = buildCDF(components, toCDFTokens(tokens));
  if (!cdf) return await die('Error: nothing to push — no components or tokens resolved');

  let preview;
  try {
    preview = await client.previewImport(cdf);
  } catch (e) {
    if (e instanceof ApiError) return await die(`Error: ${formatApiError(e)}`, failureFromApiError(e));
    throw e;
  }

  recordContentfulContext(client, spaceId, environmentId);

  if (isEmptyPreview(preview)) {
    if (isTTY) {
      process.stderr.write('Nothing to change — design system is up to date.\n');
    } else {
      process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
    }
    await exitWithAnalytics(0);
  }

  const breakingWithImpact = hasBreakingChangesWithImpact(preview);

  if (!isTTY) {
    if (breakingWithImpact) {
      process.stderr.write(
        'Error: breaking changes with downstream impact detected; run apply in an interactive terminal to acknowledge them.\n',
      );
      process.stdout.write(JSON.stringify(buildPreviewOutput(preview, spaceId, environmentId), null, 2) + '\n');
      await exitWithAnalytics(1);
    }
    await applyNonInteractive({
      client,
      cdf,
      spaceId,
      environmentId,
      acknowledgeBreakingChanges: false,
      host,
    });
    return;
  }

  await new Promise<void>((resolvePromise) => {
    const runApplyInteractive = async (acknowledge: boolean) => {
      await applyInteractive({
        client,
        cdf,
        spaceId,
        environmentId,
        host,
        acknowledgeBreakingChanges: acknowledge,
        rerender: (element) => instance.rerender(createElement(GoodbyeBoundary, null, element)),
        onDone: resolvePromise,
      });
    };

    const instance = renderWithGoodbye(
      createElement(ServerPreviewConfirm, {
        preview,
        spaceId,
        environmentId,
        breakingWithImpact,
        onConfirm: (acknowledge: boolean) => {
          void runApplyInteractive(acknowledge);
        },
        onCancel: () => {
          void exitWithAnalytics(0);
        },
      }),
    );

    void instance.waitUntilExit().then(() => resolvePromise());
  });
}
