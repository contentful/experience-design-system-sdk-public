/**
 * MCP server exposing the PTY harness so an LLM can drive the `experiences`
 * wizard interactively.
 *
 * Session-oriented: `spawn_wizard` returns a sessionId, subsequent calls
 * take that id. Sessions live in a Map; auto-closed on shutdown.
 *
 * Wire up in Claude Code:
 *   claude mcp add eds-tui -- node /abs/path/to/bin/mcp.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawnWizard } from './harness.mjs';

const sessions = new Map();
let nextId = 1;

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw new Error(`Unknown sessionId: ${sessionId}`);
  return s;
}

function tailLines(str, n) {
  if (n < 0) return str;
  const lines = str.split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

function ok(text) {
  return { content: [{ type: 'text', text }] };
}

function okJson(obj) {
  return ok(JSON.stringify(obj, null, 2));
}

const server = new McpServer({
  name: 'eds-tui-harness',
  version: '0.1.0',
});

server.registerTool(
  'spawn_wizard',
  {
    title: 'Spawn EDS wizard',
    description:
      'Launch the `experiences` CLI inside a PTY. Returns a sessionId used by other tools. Stubs claude/codex/opencode/cursor by default so no real LLM is called.',
    inputSchema: {
      args: z
        .array(z.string())
        .describe('argv to pass to the CLI, e.g. ["import"]'),
      cwd: z.string().optional().describe('Working directory'),
      env: z
        .record(z.string())
        .optional()
        .describe('Extra env vars merged onto process.env'),
      stub_agents: z
        .boolean()
        .optional()
        .describe(
          'If true (default), shadow claude/codex/opencode/cursor with the offline stub. Set false to hit the real agent binaries on $PATH.',
        ),
      cols: z.number().int().optional(),
      rows: z.number().int().optional(),
    },
  },
  async ({ args, cwd, env, stub_agents, cols, rows }) => {
    const harness = await spawnWizard(args, {
      cwd,
      env,
      stubAgents: stub_agents !== false,
      cols,
      rows,
    });
    const sessionId = `s${nextId++}`;
    sessions.set(sessionId, harness);
    return okJson({ sessionId });
  },
);

server.registerTool(
  'send_keys',
  {
    title: 'Send key sequence',
    description:
      'Send one or more named keys or single characters to the PTY (e.g. ["down","down","enter"]).',
    inputSchema: {
      sessionId: z.string(),
      keys: z
        .array(z.string())
        .describe(
          'Named keys (enter, tab, esc, up, down, left, right, space, backspace, ctrl-c, ctrl-d, ctrl-s, home, end) or single characters.',
        ),
    },
  },
  async ({ sessionId, keys }) => {
    getSession(sessionId).writeKeys(keys);
    return okJson({ ok: true, sent: keys.length });
  },
);

server.registerTool(
  'send_text',
  {
    title: 'Send text',
    description: 'Write a literal string to the PTY (does NOT press enter).',
    inputSchema: {
      sessionId: z.string(),
      text: z.string(),
    },
  },
  async ({ sessionId, text }) => {
    getSession(sessionId).writeText(text);
    return okJson({ ok: true, bytes: text.length });
  },
);

server.registerTool(
  'wait_for',
  {
    title: 'Wait for screen pattern',
    description:
      'Poll the screen until the pattern appears (or timeout). Returns the matched screen tail on success, throws on timeout.',
    inputSchema: {
      sessionId: z.string(),
      pattern: z.string().describe('String or regex source'),
      is_regex: z.boolean().optional(),
      timeout_ms: z.number().int().optional().describe('Default 5000'),
      tail_lines: z
        .number()
        .int()
        .optional()
        .describe('Lines of screen tail to return (default 40)'),
    },
  },
  async ({ sessionId, pattern, is_regex, timeout_ms, tail_lines }) => {
    const h = getSession(sessionId);
    const pat = is_regex ? new RegExp(pattern) : pattern;
    const screen = await h.waitFor(pat, { timeout: timeout_ms ?? 5000 });
    return okJson({
      matched: true,
      screen_tail: tailLines(screen, tail_lines ?? 40),
    });
  },
);

server.registerTool(
  'read_screen',
  {
    title: 'Read screen',
    description:
      'Return the current PTY buffer. Defaults to ANSI-stripped tail of 40 lines. Use tail_lines=-1 for the full buffer.',
    inputSchema: {
      sessionId: z.string(),
      tail_lines: z
        .number()
        .int()
        .optional()
        .describe('Default 40; pass -1 for full buffer'),
      raw: z
        .boolean()
        .optional()
        .describe('If true, return the raw buffer with ANSI escape codes'),
    },
  },
  async ({ sessionId, tail_lines, raw }) => {
    const h = getSession(sessionId);
    const buf = raw ? h.getRaw() : h.getScreen();
    return ok(tailLines(buf, tail_lines ?? 40));
  },
);

server.registerTool(
  'close',
  {
    title: 'Close session',
    description: 'Terminate the PTY child and drop the session.',
    inputSchema: { sessionId: z.string() },
  },
  async ({ sessionId }) => {
    const h = sessions.get(sessionId);
    if (h) {
      await h.close();
      sessions.delete(sessionId);
    }
    return okJson({ ok: true });
  },
);

server.registerTool(
  'list_sessions',
  {
    title: 'List sessions',
    description: 'Return the ids and status of all live sessions.',
    inputSchema: {},
  },
  async () => {
    const items = [];
    for (const [id, h] of sessions) {
      items.push({
        sessionId: id,
        exited: h.isExited(),
        exitInfo: h.getExitInfo(),
      });
    }
    return okJson({ sessions: items });
  },
);

async function shutdown() {
  const closures = [];
  for (const h of sessions.values()) closures.push(h.close().catch(() => {}));
  await Promise.all(closures);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
