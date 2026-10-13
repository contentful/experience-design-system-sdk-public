import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliUserAgent } from '../../src/tui/user-agent.js';

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

describe('cliUserAgent', () => {
  it('names the CLI and its own package version, as legacy did', () => {
    expect(cliUserAgent()).toContain(`app contentful.experience-design-system-cli/${packageVersion}`);
  });

  it('follows CEP-0056: app, platform and os segments, ending in a semicolon', () => {
    expect(cliUserAgent()).toMatch(/^app [^;]+; platform node\.js\/v[\d.]+; (os \w+\/v[\d.]+;)?$/);
  });

  it('carries nothing about the user or their content', () => {
    const agent = cliUserAgent();

    expect(agent).not.toContain(process.env['HOME'] ?? '/no-home');
    expect(agent).not.toContain(process.env['USER'] ?? 'no-user');
  });
});
