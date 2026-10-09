import { configFilePath } from '../../session/helpers/config-root.js';

export function experiencesCredentialsPath(): string {
  return configFilePath();
}
