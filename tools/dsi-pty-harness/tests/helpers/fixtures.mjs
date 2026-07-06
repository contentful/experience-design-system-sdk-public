import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the hand-crafted React fixture (Button, Card, Icon). */
export const REACT_MINIMAL = resolve(HERE, '../../fixtures/projects/react-minimal');
