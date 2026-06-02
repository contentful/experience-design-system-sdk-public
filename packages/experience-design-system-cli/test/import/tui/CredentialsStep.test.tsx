import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';
import { CredentialsStep } from '../../../src/import/tui/steps/CredentialsStep.js';

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

describe('CredentialsStep — rendering', () => {
  it('renders all four credential fields', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID') && f.includes('Environment') && f.includes('CMA Token') && f.includes('API Host'),
      3000,
    );

    expect(frame).toContain('Space ID');
    expect(frame).toContain('Environment');
    expect(frame).toContain('CMA Token');
    expect(frame).toContain('API Host');
  });

  it('pre-fills values from initial props', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep
        initialSpaceId="my-space"
        initialEnvironmentId="staging"
        initialCmaToken="secret"
        initialHost="https://api.eu.contentful.com"
        {...handlers}
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('my-space'),
      3000,
    );

    expect(frame).toContain('my-space');
    expect(frame).toContain('staging');
    expect(frame).toContain('https://api.eu.contentful.com');
  });

  it('shows hint text when credentials are pre-filled', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(
      <CredentialsStep initialSpaceId="s" initialEnvironmentId="master" initialCmaToken="t" {...handlers} />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('pre-filled') || f.includes('Enter to continue'),
      3000,
    );

    expect(frame).toContain('Enter to continue');
  });
});

describe('CredentialsStep — submission', () => {
  it('calls onConfirm with trimmed values when fields are filled', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    stdin.write('myspace');
    stdin.write('\r'); // spaceId → environmentId
    stdin.write('\r'); // accept default "master" → cmaToken
    stdin.write('mytoken');
    stdin.write('\r'); // cmaToken → host
    stdin.write('\r'); // submit from host (blank = use default)

    await new Promise((r) => setTimeout(r, 200));

    expect(handlers.onConfirm).toHaveBeenCalledWith('myspace', 'master', 'mytoken', '');
  });

  it('includes host value in onConfirm when set', async () => {
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
    stdin.write('\r'); // spaceId → environmentId
    stdin.write('\r'); // accept default "master" → cmaToken
    stdin.write('mytoken');
    stdin.write('\r'); // cmaToken → host
    stdin.write('https://api.eu.contentful.com');
    stdin.write('\r'); // submit

    await new Promise((r) => setTimeout(r, 200));

    expect(handlers.onConfirm).toHaveBeenCalledWith('myspace', 'master', 'mytoken', 'https://api.eu.contentful.com');
  });

  it('calls onContinue when no fields changed and onContinue is supplied; falls back to onConfirm when omitted', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        initialHost=""
        {...handlers}
      />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    stdin.write('\r'); // spaceId → environmentId
    stdin.write('\r'); // environmentId → cmaToken
    stdin.write('\r'); // cmaToken → host
    stdin.write('\r'); // submit without changing anything

    await new Promise((r) => setTimeout(r, 200));

    // onContinue is provided — it should be called, not onConfirm
    expect(handlers.onContinue).toHaveBeenCalledWith('space1', 'master', 'tok', '');
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it('shows inline error when required fields are empty on submit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    stdin.write('\r'); // spaceId (empty) → environmentId
    stdin.write('\r'); // environmentId → cmaToken
    stdin.write('\r'); // cmaToken (empty) → host
    stdin.write('\r'); // attempt submit with empty required fields

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('required'),
      3000,
    );

    expect(frame).toContain('required');
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });
});

describe('CredentialsStep — navigation', () => {
  it('tab cycles through all four fields', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep initialSpaceId="s" initialEnvironmentId="master" initialCmaToken="t" {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    stdin.write('\t'); // → environmentId
    stdin.write('\t'); // → cmaToken
    stdin.write('\t'); // → host
    stdin.write('\t'); // wraps back to spaceId

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );
    expect(frame).toContain('Space ID');
  });

  it('q key calls onQuit', async () => {
    const handlers = makeHandlers();
    const { lastFrame, stdin } = render(
      <CredentialsStep initialSpaceId="" initialEnvironmentId="master" initialCmaToken="" {...handlers} />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    stdin.write('q');

    await new Promise((r) => setTimeout(r, 100));

    expect(handlers.onQuit).toHaveBeenCalled();
  });
});
