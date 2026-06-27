import React from 'react';

/**
 * Interactive credentials fallback for `experiences import --push-from-run`.
 *
 * The wizard ships a full `CredentialsStep` Ink component already — rather
 * than reimplementing the field-entry UI, we mount that step in a tiny Ink
 * app that resolves a promise once the operator confirms.
 *
 * Returns the four credential values (host comes back as a configured host
 * string, e.g. `api.contentful.com`).
 */
export type CollectedCredentials = {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
};

export type PromptForCredentialsOptions = {
  initialSpaceId?: string;
  initialEnvironmentId?: string;
  initialCmaToken?: string;
  initialHost?: string;
  /** Short summary line rendered above the form. */
  summary?: string;
};

export async function promptForPushCredentials(opts: PromptForCredentialsOptions = {}): Promise<CollectedCredentials> {
  const { render, Box, Text } = await import('ink');
  const { useState } = await import('react');
  const { CredentialsStep } = await import('../import/tui/steps/CredentialsStep.js');

  return new Promise<CollectedCredentials>((resolve, reject) => {
    let app: { unmount: () => void } | null = null;

    function App(): React.ReactElement {
      const [done, setDone] = useState(false);
      const handle = (spaceId: string, environmentId: string, cmaToken: string, host: string) => {
        if (done) return;
        setDone(true);
        // Defer unmount so Ink flushes the final render.
        queueMicrotask(() => {
          app?.unmount();
          resolve({ spaceId, environmentId, cmaToken, host });
        });
      };
      if (done) {
        return React.createElement(Box, null, React.createElement(Text, null, ''));
      }
      return React.createElement(CredentialsStep, {
        summary: opts.summary ?? 'Enter Contentful credentials to push this run. Press Enter on each field to advance.',
        ...(opts.initialSpaceId !== undefined ? { initialSpaceId: opts.initialSpaceId } : {}),
        ...(opts.initialEnvironmentId !== undefined ? { initialEnvironmentId: opts.initialEnvironmentId } : {}),
        ...(opts.initialCmaToken !== undefined ? { initialCmaToken: opts.initialCmaToken } : {}),
        ...(opts.initialHost !== undefined ? { initialHost: opts.initialHost } : {}),
        onConfirm: handle,
        onContinue: handle,
        onQuit: () => {
          app?.unmount();
          reject(new Error('Credentials entry cancelled.'));
        },
      });
    }

    app = render(React.createElement(App));
  });
}
