import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectValidCdf, expectValidTokens } from './cdf.js';
import { startFakeAgent, type FakeAgent } from './fake-agent.js';
import { startFakeContentful, type FakeContentful } from './fake-contentful.js';
import { startImport, type ImportSession } from './harness.js';
import {
  acceptEverythingInReview,
  acceptEverythingInScopeGate,
  chooseWhatToImport,
  enterCredentials,
  confirmScan,
  enterProjectPath,
  enterTokenFile,
  saveAndPush,
} from './steps.js';
import { createWorld, type ImportWorld } from './world.js';

/** The fixture's Button has four props and its size is a fixed set of values, so that is what the push must carry. */
function expectButtonFromFixtureWasPushed(contentful: FakeContentful): void {
  type Properties = Record<string, { $type: string; $values?: string[] }>;
  const button = (contentful.pushed[0]?.['Button'] as { $properties: Properties }).$properties;
  expect(Object.keys(button).sort()).toEqual(['color', 'label', 'size', 'url']);
  expect(button['size']).toMatchObject({ $type: 'enum', $values: ['lg', 'md', 'sm'] });
}

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

  it('both: tokens and components import end to end, and the saved CDF is valid', async () => {
    await chooseWhatToImport(app, 'both');
    await enterProjectPath(app, world.projectDir);
    await enterTokenFile(app, world.tokensFile);
    await confirmScan(app);
    await enterCredentials(app, contentful);

    await acceptEverythingInScopeGate(app, 6);
    await acceptEverythingInReview(app);
    await saveAndPush(app);
    await app.waitForText('Done!');
    expect(app.screen()).toContain('6 Components created');
    expect(app.screen()).toContain('22 Design Tokens created');
    expect(app.screen()).toContain('Push result: 28/28 succeeded');

    // Token generation runs alongside extraction, so the order of the agent's calls is not fixed.
    expect((await agent.calls()).sort()).toEqual(
      ['compose', 'generate-tokens', 'map-tokens', 'select', ...Array(6).fill('generate-components')].sort(),
    );
    expectButtonFromFixtureWasPushed(contentful);
    await expectValidCdf(world.outDir);
    await expectValidTokens(world.outDir);
  }, 90_000);

  it('components only: components import end to end, and the saved CDF is valid', async () => {
    await chooseWhatToImport(app, 'components');
    await enterProjectPath(app, world.projectDir);
    await confirmScan(app);
    await enterCredentials(app, contentful);

    // Extraction finds the fixture's six components and the user accepts them all.
    await acceptEverythingInScopeGate(app, 6);

    // The agent classifies each component, the user accepts the result, and the import saves and pushes it.
    await acceptEverythingInReview(app);
    await saveAndPush(app);
    await app.waitForText('Done!');
    expect(app.screen()).toContain('6 Components created');
    expect(app.screen()).toContain('Push result: 6/6 succeeded');

    expect(await agent.calls()).toEqual(['compose', 'select', ...Array(6).fill('generate-components')]);
    expect(Object.keys(contentful.pushed[0] ?? {}).filter((key) => !key.startsWith('$'))).toEqual(
      expect.arrayContaining(['Button', 'Flex', 'Image', 'SiteFooter', 'SiteHeader', 'Text']),
    );
    expectButtonFromFixtureWasPushed(contentful);
    await expectValidCdf(world.outDir);
  }, 90_000);

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
