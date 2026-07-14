import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the hand-crafted React fixture (Button, Card, Icon). */
export const REACT_MINIMAL = resolve(HERE, '../../fixtures/projects/react-minimal');

/**
 * Absolute path to a React fixture whose component graph contains a
 * NodeA↔NodeB slot cycle. Used by cycle-detection tests (D2-2, D2-3).
 */
export const REACT_COMPOSITE_CYCLE = resolve(HERE, '../../fixtures/projects/react-composite-cycle');

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
