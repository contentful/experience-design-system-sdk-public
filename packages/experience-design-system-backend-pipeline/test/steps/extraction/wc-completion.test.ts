import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  extractEndpoint,
  extractWebComponentDefinitions as extractPublic,
} from '@contentful/experience-design-system-extraction';
import { extractComponents } from '../../../src/index.js';
import { extractWebComponentDefinitions } from '../../../src/steps/extraction/src/framework-adapters/web-components/extract-web-components.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

it('preserves nested function-returned JS inheritance and own-file locations through the live backend adapter', async () => {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'backend-wc-completion-')));
  directories.push(directory);
  const base = join(directory, 'Base.js');
  const mixins = join(directory, 'Mixins.js');
  const file = join(directory, 'Example.js');
  writeFileSync(base, `export class Base extends HTMLElement { inherited = 0; shared = 1; }`);
  writeFileSync(
    mixins,
    `export function Inner(Base) { return class InnerClass extends Base { inner = false; shared = false; }; } export const Outer = (Base) => class OuterClass extends Inner(Base) { outer = ''; };`,
  );
  writeFileSync(
    file,
    `import { Base } from './Base.js'; import { Outer } from './Mixins.js'; class Example extends Outer(Base) { shared = 'own'; } customElements.define('example-component', Example);`,
  );
  const direct = await extractPublic([file], undefined, { projectRoot: directory });
  const result = await extractWebComponentDefinitions([file], undefined, { projectRoot: directory });
  expect(result.components[0]!.sourceCandidates).toEqual(direct.components[0]!.sourceCandidates);
  expect(result.components[0]!.props.map((prop) => prop.name)).toEqual(['inherited', 'inner', 'outer', 'shared']);
  const candidate = result.components[0]!.sourceCandidates!.find((item) => item.name === 'shared')!;
  expect(candidate.observations.filter((item) => item.evidenceKind === 'declaration')).toHaveLength(3);
  expect(new Set(candidate.observations.map((item) => item.location!.canonicalPath))).toEqual(
    new Set([file, mixins, base]),
  );
  expect(candidate.facts!.certainty).toBe('ambiguous');
});

it.each([false, true])(
  'keeps duplicate winner and loser separate across sorted compiler partitions (reverse=%s)',
  async (reverse) => {
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'backend-wc-duplicates-')));
    directories.push(directory);
    const family = join(directory, 'src', 'Example');
    const second = join(directory, 'src', 'Other');
    mkdirSync(family, { recursive: true });
    mkdirSync(second, { recursive: true });
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { allowJs: false, noEmit: false }, include: ['src/**/*.js'] }),
    );
    writeFileSync(
      join(second, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'invalid', noEmit: false }, include: ['*.js'] }),
    );
    const winnerPath = join(family, 'index.js');
    const loserPath = join(family, 'Example.js');
    const otherPath = join(second, 'Other.js');
    writeFileSync(
      winnerPath,
      `class Example extends HTMLElement { static properties = { value: { type: Number, attribute: 'winner-value', reflect: false } }; value = 0; } customElements.define('example-component', Example);`,
    );
    writeFileSync(
      loserPath,
      `class Example extends unknownFactory(HTMLElement) { static properties = { losingOnly: { type: String, attribute: 'loser-value' } }; losingOnly = ''; } customElements.define('example-component', Example);`,
    );
    writeFileSync(
      otherPath,
      `class Other extends HTMLElement { active = false; } customElements.define('other-component', Other);`,
    );
    const paths = [otherPath, loserPath, winnerPath];
    if (reverse) paths.reverse();
    const result = await extractComponents({ filePaths: paths, projectRoot: directory });
    const publicResult = await extractEndpoint({ filePaths: paths, projectRoot: directory });
    expect(result.components.map((component) => component.name)).toEqual(['Example', 'Other']);
    const winner = result.components[0]!;
    expect(winner.sourcePath).toBe(winnerPath);
    expect(winner.sourceCandidates!.some((candidate) => candidate.name === 'losingOnly')).toBe(false);
    const loser = winner.sourceCandidateSources!.find((source) => source.sourcePath === loserPath)!;
    expect(loser.componentName).toBe('Example');
    expect(loser.candidates!.some((candidate) => candidate.name === 'losingOnly')).toBe(true);
    expect(
      loser
        .candidates!.flatMap((candidate) => candidate.observations)
        .some(
          (observation) =>
            observation.syntax?.reader === 'web-component' && observation.syntax.attribute.name === 'loser-value',
        ),
    ).toBe(true);
    expect(winner.sourceCandidates).toEqual(publicResult.components[0]!.sourceCandidates);
    expect(winner.sourceCandidateSources).toEqual(publicResult.components[0]!.sourceCandidateSources);
    expect(result.exclusions).toContainEqual(expect.objectContaining({ source: loserPath, stage: 'duplicate-filter' }));
    expect(result.warnings.some((warning) => warning.includes('Duplicate component'))).toBe(true);
    expect(result.extractionDiagnostics!.modules).toContainEqual(
      expect.objectContaining({ fromPath: loserPath, reason: 'wc-unresolved-mixin' }),
    );
    expect(result.extractionDiagnostics!.projects.some((project) => project.status === 'invalid')).toBe(true);
    expect(new Set(result.extractionDiagnostics!.projects.map((project) => project.root)).size).toBeGreaterThan(1);
  },
);
