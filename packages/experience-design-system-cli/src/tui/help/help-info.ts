import { configFilePath, configRoot, debugSessionsDir } from '@contentful/experience-design-system-types/config';
import { currentDebugSessionDir } from '../debug-store.js';
import { readDebugModeSetting } from '../settings/debug-mode/debug-mode-store.js';
import { readPackageVersion } from '../upgrade/version.js';

export interface HelpRow {
  label: string;
  value: string;
}

export interface HelpInfo {
  storage: HelpRow[];
  troubleshooting: HelpRow[];
}

// Everything here is paths and versions. Nothing reads the settings file, so no credential can reach the screen.
export async function readHelpInfo(): Promise<HelpInfo> {
  const debugMode = await readDebugModeSetting();

  return {
    storage: [
      { label: 'Config folder', value: configRoot() },
      { label: 'Settings file', value: configFilePath() },
      { label: 'Debug logs', value: debugSessionsDir() },
      { label: 'Move it with', value: process.env['EDS_HOME'] ? 'EDS_HOME (set)' : 'EDS_HOME (not set)' },
    ],
    troubleshooting: [
      { label: 'CLI version', value: readPackageVersion() },
      { label: 'Node', value: process.version },
      { label: 'Platform', value: `${process.platform} ${process.arch}` },
      { label: 'Debug Mode', value: debugMode.enabled ? 'on' : 'off' },
      {
        label: 'This session',
        value: debugMode.enabled ? currentDebugSessionDir() : 'no logs written while Debug Mode is off',
      },
    ],
  };
}
