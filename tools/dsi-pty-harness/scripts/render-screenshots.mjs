#!/usr/bin/env node
/**
 * Render each `<slug>.txt` snapshot in docs/screenshots/ to a matching
 * `<slug>.png` using silicon.
 *
 * silicon is a Rust binary — install with `brew install silicon`. It
 * needs a syntax grammar; we use `log` because it's line-oriented and
 * treats output as-is (no keyword highlighting), aside from tokenizing
 * bare numbers with a bit of color. Good enough for terminal UI shots.
 *
 * The .txt files have a front-matter block (title + caption + `-`*80
 * separator) that we strip before rendering.
 *
 * Usage:
 *   node tools/dsi-pty-harness/scripts/render-screenshots.mjs [slug...]
 *
 * With no args, renders all *.txt. With slugs, renders only those.
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(HERE, '../docs/screenshots');

const SEPARATOR_REGEX = /^-{20,}$/;

// Silicon flags — tuned for docs-quality terminal PNGs at ~2000px wide.
const SILICON_FLAGS = [
  '--language', 'log',
  '--theme', 'Monokai Extended',
  '--no-line-number',
  '--no-window-controls',
  '--background', '#0d1117',
  '--pad-horiz', '32',
  '--pad-vert', '32',
  '--font', 'Menlo=16',
];

/** Strip title + caption + separator; return terminal body only. */
function extractBody(text) {
  const lines = text.split('\n');
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SEPARATOR_REGEX.test(lines[i].trim())) {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx < 0) return text.trimEnd() + '\n';
  return lines.slice(sepIdx + 1).join('\n').replace(/^\n+/, '').trimEnd() + '\n';
}

function render(slug) {
  const src = join(SCREENSHOTS_DIR, `${slug}.txt`);
  const dst = join(SCREENSHOTS_DIR, `${slug}.png`);
  const body = extractBody(readFileSync(src, 'utf8'));

  const tmpFile = join(tmpdir(), `silicon-${slug}-${process.pid}.log`);
  writeFileSync(tmpFile, body);
  try {
    execFileSync('silicon', [tmpFile, '--output', dst, ...SILICON_FLAGS], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }

  const { size } = statSync(dst);
  console.log(`✓ ${slug}.png (${(size / 1024).toFixed(0)} kB)`);
}

const wantSlugs = process.argv.slice(2);
const allSlugs = readdirSync(SCREENSHOTS_DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.replace(/\.txt$/, ''));
const runSlugs = wantSlugs.length > 0 ? wantSlugs : allSlugs;

let ok = 0;
const failed = [];
for (const slug of runSlugs) {
  try {
    render(slug);
    ok++;
  } catch (e) {
    const stderr = e.stderr?.toString() ?? '';
    console.error(`✗ ${slug}: ${e.message.split('\n')[0]}`);
    if (stderr) console.error('  ' + stderr.split('\n').slice(0, 3).join('\n  '));
    failed.push(slug);
  }
}

console.log(`\n${ok}/${runSlugs.length} rendered`);
if (failed.length) process.exit(1);
