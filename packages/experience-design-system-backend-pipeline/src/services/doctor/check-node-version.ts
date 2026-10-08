import { REQUIRED_NODE_MAJOR } from './constants/node-version.js';

export interface NodeVersionCheck {
  passed: boolean;
  version: string;
  major: number;
  required: number;
}

export function checkNodeVersion(nodeVersion: string = process.versions.node): NodeVersionCheck {
  const major = Number.parseInt(nodeVersion.split('.')[0]!, 10);
  return {
    passed: major >= REQUIRED_NODE_MAJOR,
    version: nodeVersion,
    major,
    required: REQUIRED_NODE_MAJOR,
  };
}
