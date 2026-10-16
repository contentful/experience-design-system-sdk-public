import { describe, expect, it } from 'vitest';
import { describeFileLocations } from '../../src/tui/help/file-locations.js';

// Help tells people where to look for their logs and tokens.json / components.json, so these pin the rules from
// `startImportRun`: the Root Project Directory and Debug Mode decide where everything goes.
describe('where Help says the CLI writes its files', () => {
  it('uses the running session folder when Debug Mode is on', () => {
    const result = describeFileLocations({
      contentfulBaseDir: '/work/site',
      debugModeEnabled: true,
      currentSessionDir: '/work/site/.contentful/10-16-2026-session-2',
    });

    expect(result.debugLogs).toBe('/work/site/.contentful/10-16-2026-session-2/debug');
    expect(result.importFiles).toBe(
      '/work/site/.contentful/10-16-2026-session-2/dsi-import-<n>/ (tokens.json, components.json)',
    );
  });

  it('shows a pattern under the Root Project Directory before a session has started', () => {
    const result = describeFileLocations({
      contentfulBaseDir: '/work/site',
      debugModeEnabled: true,
      currentSessionDir: undefined,
    });

    expect(result.debugLogs).toBe('/work/site/.contentful/<date>-session-<n>/debug');
  });

  it('leaves the project to the import when there is no Root Project Directory', () => {
    const result = describeFileLocations({
      contentfulBaseDir: '',
      debugModeEnabled: true,
      currentSessionDir: undefined,
    });

    expect(result.debugLogs).toBe('<project>/.contentful/<date>-session-<n>/debug');
    expect(result.importFiles).toContain('<project>/.contentful/<date>-session-<n>/dsi-import-<n>/');
  });

  it('writes no logs and no session folder when Debug Mode is off, whatever the Root Project Directory is', () => {
    const result = describeFileLocations({
      contentfulBaseDir: '/work/site',
      debugModeEnabled: false,
      currentSessionDir: '/work/site/.contentful/10-16-2026-session-2',
    });

    expect(result.debugLogs).toBe('none while Debug Mode is off');
    expect(result.importFiles).toBe('<project>/.contentful/ (tokens.json, components.json)');
  });
});
