import { configFilePath, configRoot, readSettings } from '@contentful/experience-design-system-types/config';
import { currentDebugSessionDir, currentSessionDir } from '../debug-store.js';
import { readDebugModeSetting } from '../settings/debug-mode/debug-mode-store.js';
import { readPackageVersion } from '../home/version.js';
import { describeFileLocations } from './file-locations.js';

export interface HelpRow {
  label: string;
  value: string;
}

export interface HelpInfo {
  storage: HelpRow[];
  troubleshooting: HelpRow[];
}

// Everything here is paths and versions. It reads the settings file only for two path settings (the Root Project
// Directory and whether Debug Mode is on) and never returns a value from it, so no credential can reach the screen.
export async function readHelpInfo(): Promise<HelpInfo> {
  const [debugMode, settings] = await Promise.all([readDebugModeSetting(), readSettings()]);
  const base = settings['contentfulBaseDir'];
  const locations = describeFileLocations({
    contentfulBaseDir: typeof base === 'string' ? base : '',
    debugModeEnabled: debugMode.enabled,
    currentSessionDir: currentSessionDir(),
  });

  return {
    storage: [
      { label: 'Config folder', value: configRoot() },
      { label: 'Settings file', value: configFilePath() },
      { label: 'Agent settings', value: `${configFilePath()} (keys: agent, agentModel, agents)` },
      { label: 'Debug logs', value: locations.debugLogs },
      { label: 'Import files', value: locations.importFiles },
    ],
    troubleshooting: [
      { label: 'CLI version', value: readPackageVersion() },
      { label: 'Node', value: process.version },
      { label: 'Platform', value: `${process.platform} ${process.arch}` },
      { label: 'Debug Mode', value: debugMode.enabled ? 'on' : 'off' },
      {
        label: 'This session',
        value: !debugMode.enabled
          ? 'no logs written while Debug Mode is off'
          : (currentDebugSessionDir() ?? 'not started: set the Root Project Directory in Settings, or start an import'),
      },
    ],
  };
}
