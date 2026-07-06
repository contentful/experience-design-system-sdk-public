import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the hand-crafted React fixture (Button, Card, Icon). */
export const REACT_MINIMAL = resolve(HERE, '../../fixtures/projects/react-minimal');

/**
 * A pre-baked components.json produced by the wizard on `REACT_MINIMAL`
 * (via `analyze extract` + stub generate). Used by push-flow tests so
 * they don't need to re-run the pipeline every time.
 */
export const REACT_MINIMAL_COMPONENTS_JSON = resolve(
  HERE,
  '../../fixtures/components/react-minimal.components.json',
);
