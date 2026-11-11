import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setEnv } from './env.js';

// The stand-in for the `claude` CLI. The pipeline already lets EDS_AGENT_BINARY_CLAUDE point at another binary, so this
// is a real subprocess the real code spawns, parses and times out. It answers `auth status --json`, and for every other
// call it reads the prompt, works out which skill it is for and prints the tool-call lines that skill's parser expects.

export interface FakeAgent {
  /** What the pipeline was asked to run, one skill name per call, in order. */
  calls(): Promise<string[]>;
  stop(): Promise<void>;
}

// Plain CommonJS, because it is written to a file with no extension and run by node.
const SCRIPT = String.raw`
const { appendFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const note = (skill) => process.env.FAKE_AGENT_CALLS && appendFileSync(process.env.FAKE_AGENT_CALLS, skill + '\n');
const say = (value) => process.stdout.write(JSON.stringify(value) + '\n');

process.on('uncaughtException', (error) => { note('crash ' + error.message); process.exit(1); });
if (args[0] === 'auth') {
  say({ loggedIn: true });
  process.exit(0);
}

// The prompt arrives on stdin for some skills and as the last argument for the rest.
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (stdin += chunk));
process.stdin.on('end', () => {
  const prompt = stdin || args[args.length - 1] || '';
  if (process.env.FAKE_AGENT_DUMP) writeFileSync(process.env.FAKE_AGENT_DUMP + '/prompt-' + Date.now() + '-' + process.pid + '.txt', prompt);
  if (prompt.includes('"tool":"map_edge"')) return composeComponents();
  if (prompt.includes('select_component') && prompt.includes('reject_component')) return selectComponents(prompt);
  if (prompt.includes('map_token_prop')) return mapTokens();
  if (prompt.includes('classify_prop') && prompt.includes('classify_slot')) return generateComponents(prompt);
  if (prompt.includes('set_token') && prompt.includes('set_group')) return generateTokens(prompt);
  note('unknown');
  process.stderr.write('fake agent: no answer is scripted for this prompt\n');
  process.exit(1);
});

// Composition: only edges the files state outright may be emitted, and these components state none, so there are none.
function composeComponents() {
  note('compose');
}

// Selection: the components arrive as a JSON array in the prompt; every one of them renders visible UI, so all are kept.
function selectComponents(prompt) {
  note('select');
  const json = prompt.match(/\x60\x60\x60json\n([\s\S]*?)\n\x60\x60\x60/);
  const components = json ? JSON.parse(json[1]) : [];
  for (const component of components) say({ tool: 'select_component', name: component.name, reason: 'renders visible UI', confidence: 5 });
}

// Token mapping only narrows which tokens a prop accepts when the source says so outright, and these sources do not.
function mapTokens() {
  note('map-tokens');
}

// Generation: one component per call, with its props and slots in the prompt. Each prop is classified from its own data:
// a fixed set of values is an enum, colour and size props are design tokens, the rest are plain strings.
function generateComponents(prompt) {
  note('generate-components');
  const blocks = [...prompt.matchAll(/\x60\x60\x60json\n([\s\S]*?)\n\x60\x60\x60/g)].map((match) => {
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  });
  const components = blocks.find((block) => Array.isArray(block) && block.length > 0 && Array.isArray(block[0].props)) || [];
  for (const component of components) {
    say({ tool: 'classify_component', description: 'The ' + component.name + ' component.', rationale: { description: 'Renders visible UI.', props: 'Every prop is classified.', slots: 'Every slot is classified.' } });
    for (const prop of component.props) say(classifyProp(prop));
    for (const slot of component.slots || []) say({ tool: 'classify_slot', slot: slot.name, required: false, allowed_components: [], description: 'What goes inside ' + component.name + '.', rationale: 'Kept so editors can compose it.' });
  }
}

function classifyProp(prop) {
  const base = { tool: 'classify_prop', prop: prop.name, required: Boolean(prop.required), description: 'The ' + prop.name + '.', reason: 'Scripted classification.' };
  if (Array.isArray(prop.allowedValues) && prop.allowedValues.length > 0) return { ...base, cdf_type: 'enum', cdf_category: 'design', values: prop.allowedValues };
  if (/boolean/.test(prop.type || '')) return { ...base, cdf_type: 'boolean', cdf_category: 'state' };
  const tokenKind = /color/i.test(prop.name) ? 'color' : /spacing|radius|gap|size/i.test(prop.name) ? 'dimension' : null;
  if (tokenKind) return { ...base, cdf_type: 'token', cdf_category: 'design', token_kind: tokenKind };
  return { ...base, cdf_type: 'string', cdf_category: prop.category === 'design' ? 'design' : 'content' };
}

// A stable colour per name, so the same token file always gives the same tokens.
function colorFor(name) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffff;
  return '#' + hash.toString(16).padStart(6, '0');
}

const SIZES = { spacing: ['4px', '8px', '16px', '24px', '32px'], text: ['0.875rem', '1rem', '1.25rem', '1.5rem'], radius: ['2px', '4px', '8px'] };

function generateTokens(prompt) {
  note('generate-tokens');
  const found = [...prompt.matchAll(/"([a-zA-Z]+)\.([A-Za-z0-9]+)":\s*"var\(--[a-z0-9-]+\)"/g)];
  const groups = [...new Set(found.map((m) => m[1]))];
  const index = {};
  for (const group of groups) {
    say({ tool: 'set_group', path: group, description: group + ' tokens' });
  }
  for (const [, group, name] of found) {
    index[group] = (index[group] || 0) + 1;
    const value = group === 'color' ? colorFor(name) : (SIZES[group] || ['1px'])[(index[group] - 1) % (SIZES[group] || ['1px']).length];
    say({ tool: 'set_token', path: group + '.' + name, type: group === 'color' ? 'color' : 'dimension', value, description: name });
  }
}
`;

export async function startFakeAgent(): Promise<FakeAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-agent-'));
  const binary = join(dir, 'claude');
  const callsFile = join(dir, 'calls.log');
  // The shebang names node itself: through `env`, a large prompt argument gets the process killed before it starts.
  await writeFile(binary, `#!${process.execPath}${SCRIPT}`, { mode: 0o755 });
  await chmod(binary, 0o755);
  await writeFile(callsFile, '');

  const restoreEnv = setEnv({ EDS_AGENT_BINARY_CLAUDE: binary, FAKE_AGENT_CALLS: callsFile });

  return {
    calls: async () => (await readFile(callsFile, 'utf8')).split('\n').filter(Boolean),
    stop: async () => {
      restoreEnv();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
