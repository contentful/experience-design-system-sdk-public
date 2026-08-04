import { createClient } from '@hey-api/openapi-ts';
import { fileURLToPath } from 'node:url';
import oas from '../openapi.json' with { type: 'json' };

const tsConfigPath = fileURLToPath(new URL('../tsconfig.json', import.meta.url));

// @hey-api/openapi-ts assumes a browser context; shim the globals it probes
// for when run under Node. See https://github.com/hey-api/openapi-ts/issues/1730
(globalThis as { window?: unknown }).window ??= {};
(globalThis as { location?: unknown }).location ??= { href: '' };

await createClient({
  plugins: ['@hey-api/client-fetch'],
  input: oas,
  output: { path: 'src/generated', tsConfigPath },
});
