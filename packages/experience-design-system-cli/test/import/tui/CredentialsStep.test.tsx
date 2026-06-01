import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { CredentialsStep, EU_API_HOST, DEFAULT_API_HOST } from '../../../src/import/tui/steps/CredentialsStep.js';

const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

afterEach(() => {
  mockExit.mockClear();
  vi.clearAllMocks();
});

function makeHandlers() {
  return {
    onConfirm: vi.fn(),
    onContinue: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('CredentialsStep — host field rendering', () => {
  it('renders the API Host field', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('API Host'),
      3000,
    );

    expect(frame).toContain('API Host');
  });

  it('shows EU host hint text', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('eu.contentful.com'),
      3000,
    );

    expect(frame).toContain(EU_API_HOST);
  });

  it('pre-fills the host field from initialHost', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        initialHost={EU_API_HOST}
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('api.eu.contentful.com'),
      3000,
    );

    expect(frame).toContain(EU_API_HOST);
  });
});

describe('CredentialsStep — submission with host', () => {
  it('passes empty host to onConfirm when no host entered', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId=""
        initialEnvironmentId="master"
        initialCmaToken=""
        {...handlers}
      />,
    );

    await waitForFrame(() => lastFrame(), (f) => f.includes('Space ID'), 3000);

    // Type space ID, enter, type cmaToken, enter, enter (skip environmentId default), enter to host, enter to submit
    stdin.write('myspace');
    stdin.write('\r'); // advance to environmentId
    stdin.write('\r'); // accept default "master", advance to cmaToken
    stdin.write('mytoken');
    stdin.write('\r'); // advance to host
    stdin.write('\r'); // submit with blank host

    await new Promise((r) => setTimeout(r, 200));

    expect(handlers.onConfirm).toHaveBeenCalledWith('myspace', 'master', 'mytoken', '');
  });

  it('passes EU host to onConfirm when user types it in', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId=""
        initialEnvironmentId="master"
        initialCmaToken=""
        {...handlers}
      />,
    );

    await waitForFrame(() => lastFrame(), (f) => f.includes('Space ID'), 3000);

    stdin.write('myspace');
    stdin.write('\r'); // to environmentId
    stdin.write('\r'); // to cmaToken
    stdin.write('mytoken');
    stdin.write('\r'); // to host
    stdin.write(EU_API_HOST);
    stdin.write('\r'); // submit

    await new Promise((r) => setTimeout(r, 200));

    expect(handlers.onConfirm).toHaveBeenCalledWith('myspace', 'master', 'mytoken', EU_API_HOST);
  });

  it('calls onContinue (not onConfirm) when no fields change from initial values', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        initialHost={EU_API_HOST}
        {...handlers}
      />,
    );

    await waitForFrame(() => lastFrame(), (f) => f.includes('Space ID'), 3000);

    // Tab through all fields without changing them, submit from host
    stdin.write('\r'); // spaceId → environmentId
    stdin.write('\r'); // environmentId → cmaToken
    stdin.write('\r'); // cmaToken → host
    stdin.write('\r'); // host → submit

    await new Promise((r) => setTimeout(r, 200));

    expect(handlers.onContinue).toHaveBeenCalledWith('space1', 'master', 'tok', EU_API_HOST);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it('shows an error when required fields are empty on submit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId=""
        initialEnvironmentId="master"
        initialCmaToken=""
        {...handlers}
      />,
    );

    await waitForFrame(() => lastFrame(), (f) => f.includes('Space ID'), 3000);

    // Skip straight to host and try to submit without filling required fields
    stdin.write('\r'); // spaceId (empty) → environmentId
    stdin.write('\r'); // environmentId → cmaToken
    stdin.write('\r'); // cmaToken (empty) → host
    stdin.write('\r'); // attempt submit

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('required'),
      3000,
    );

    expect(frame).toContain('required');
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });
});

describe('CredentialsStep — tab navigation', () => {
  it('tab cycles through all four fields', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId="s"
        initialEnvironmentId="master"
        initialCmaToken="t"
        {...handlers}
      />,
    );

    await waitForFrame(() => lastFrame(), (f) => f.includes('Space ID'), 3000);

    // Tab forward three times to reach host field
    stdin.write('\t'); // → environmentId
    stdin.write('\t'); // → cmaToken
    stdin.write('\t'); // → host

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => {
        // host field should now be active (cyan highlight on "API Host")
        return f.includes('API Host');
      },
      3000,
    );

    expect(frame).toContain('API Host');

    // Tab once more wraps back to spaceId
    stdin.write('\t');
    const frame2 = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );
    expect(frame2).toContain('Space ID');
  });
});

describe('CredentialsStep — exports', () => {
  it('exports the correct EU host constant', () => {
    expect(EU_API_HOST).toBe('https://api.eu.contentful.com');
  });

  it('exports the correct default host constant', () => {
    expect(DEFAULT_API_HOST).toBe('https://api.contentful.com');
  });
});
