import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectValidCdf, expectValidTokens } from './cdf.js';
import { startFakeAgent, type FakeAgent } from './fake-agent.js';
import { startFakeContentful, type FakeContentful } from './fake-contentful.js';
import { startImport, type ImportSession } from './harness.js';
import { chooseWhatToImport, enterCredentials, enterTokenFile } from './steps.js';
import { createWorld, type ImportWorld } from './world.js';

// End-to-end import scenarios: the real app, driven by keystrokes, against the fixture project. Only the agent and
// Contentful are faked (see fake-agent.ts and fake-contentful.ts). Run one with `-t "tokens only"`.
describe('import scenarios', () => {
  let world: ImportWorld;
  let agent: FakeAgent;
  let contentful: FakeContentful;
  let app: ImportSession;

  beforeEach(async () => {
    world = await createWorld();
    agent = await startFakeAgent();
    contentful = await startFakeContentful();
    app = await startImport();
  });

  afterEach(async () => {
    await app.stop();
    await contentful.stop();
    await agent.stop();
    await world.remove();
  });

  it.todo('both: tokens and components import end to end, and the saved CDF is valid');
  it.todo('components only: components import end to end, and the saved CDF is valid');

  it('tokens only: tokens import end to end, and the saved CDF is valid', async () => {
    await chooseWhatToImport(app, 'tokens');
    await enterTokenFile(app, world.tokensFile);
    await enterCredentials(app, contentful);

    // The agent turns the fixture's token file into tokens, and the user reviews them.
    await app.waitForText('22 tokens generated');
    await app.press('enter');

    // The import shows what it is about to create, and pushes when asked.
    await app.waitForText('22 design tokens will be created');
    await app.press('enter');
    await app.waitForText('22 Design Tokens created');
    expect(app.screen()).toContain('Push result: 22/22 succeeded');

    expect(await agent.calls()).toEqual(['generate-tokens']);
    expect(contentful.pushed).toHaveLength(1);
    await expectValidCdf(world.outDir);
    await expectValidTokens(world.outDir);
  }, 60_000);
});
