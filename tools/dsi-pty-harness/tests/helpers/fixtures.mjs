import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the hand-crafted 13-component React fixture. */
export const REACT_MINIMAL = resolve(HERE, '../../fixtures/projects/react-minimal');

/**
 * Absolute path to a React fixture that produces a DUPLICATE_COMPONENT_NAME
 * validation error (two files export a component called `Duplicate`) plus one
 * valid component. Used by `--exclude-invalid` tests.
 */
export const REACT_INVALID = resolve(HERE, '../../fixtures/projects/react-invalid');

/**
 * A pre-baked components.json produced by the wizard on `REACT_MINIMAL`
 * (via `analyze extract` + stub generate). Used by push-flow tests so
 * they don't need to re-run the pipeline every time.
 */
export const REACT_MINIMAL_COMPONENTS_JSON = resolve(
  HERE,
  '../../fixtures/components/react-minimal.components.json',
);
