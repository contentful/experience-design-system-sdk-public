import { configFilePath } from '../session/config-root.js';

export function experiencesCredentialsPath(): string {
  return configFilePath();
}
