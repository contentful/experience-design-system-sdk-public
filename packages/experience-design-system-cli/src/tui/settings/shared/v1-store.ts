import { readSettings, writeSettings } from '@contentful/experience-design-system-types/config';

// Thin aliases kept so the settings screens read like before; the shared config module owns the file.
export const readV1Store = readSettings;
export const writeV1Store = writeSettings;
