import { describe, expect, it } from 'vitest';
import { describeFileLocations } from '../../src/tui/help/file-locations.js';

// Help must not tell people to look for logs that were never written.
describe('where Help says the CLI writes its files', () => {
  it('says there are no logs, and no session folder, when Debug Mode is off', () => {
    const result = describeFileLocations({
      contentfulBaseDir: '/work/site',
      debugModeEnabled: false,
      currentSessionDir: '/work/site/.contentful/10-16-2026-session-2',
    });

    expect(result.debugLogs).toBe('none while Debug Mode is off');
    expect(result.importFiles).toBe('<project>/.contentful/ (tokens.json, components.json)');
  });
});
