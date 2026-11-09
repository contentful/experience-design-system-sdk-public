import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const { appendFileSync } = require('node:fs');
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
  if (prompt.includes('set_token') && prompt.includes('set_group')) return generateTokens(prompt);
  note('unknown');
  process.stderr.write('fake agent: no answer is scripted for this prompt\n');
  process.exit(1);
});

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

  const previous = { binary: process.env['EDS_AGENT_BINARY_CLAUDE'], calls: process.env['FAKE_AGENT_CALLS'] };
  process.env['EDS_AGENT_BINARY_CLAUDE'] = binary;
  process.env['FAKE_AGENT_CALLS'] = callsFile;

  return {
    calls: async () => (await readFile(callsFile, 'utf8')).split('\n').filter(Boolean),
    stop: async () => {
      if (previous.binary === undefined) delete process.env['EDS_AGENT_BINARY_CLAUDE'];
      else process.env['EDS_AGENT_BINARY_CLAUDE'] = previous.binary;
      if (previous.calls === undefined) delete process.env['FAKE_AGENT_CALLS'];
      else process.env['FAKE_AGENT_CALLS'] = previous.calls;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
