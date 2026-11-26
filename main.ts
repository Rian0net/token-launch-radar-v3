// Token Launch Radar — a make.fun token-radar-01 entry (Node 22, stdlib only).
//
// Reads the sealed DefiLlama snapshot (/input/snapshot.json, or --input),
// ranks every pre-token protocol with the calibrated model in lib/model.ts,
// and writes to /output (or MAKEFUN_OUTPUT_DIR):
//   board.json    the ranked board the gate checks
//   data.js       the same radar, for the dashboard beside it
//   dashboard/    the static page (no network, no framework)
//   screenshots/  the three hand-in images
//   dossier.json  buildDossier's summary of the dashboard, written last
//
// Run locally:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image(s): hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Written last on purpose: the scorer rebuilds the dossier from this very
// /output and compares it byte for byte with what is handed in.
const dossierBytes = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
writeFileSync(join(out, 'dossier.json'), dossierBytes);

// Self-verification, added after the first working version: re-read what was
// actually written and rebuild the dossier from disk. If the bytes differ —
// a screenshot swapped after the dossier was written, a dashboard file
// edited mid-run — the program refuses its own output here, at build time,
// instead of failing the scorer's dossier_matches row at grading time. It
// also refuses a dashboard whose source outgrew the judge's whole-read cap,
// because past 65,536 bytes the judge would read a cut page and score a
// partial entry.
const writtenDossier = readFileSync(join(out, 'dossier.json'));
const rebuiltDossier = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS });
if (!writtenDossier.equals(Buffer.from(rebuiltDossier))) {
  process.stderr.write('token radar: self-check failed: dossier.json does not match a rebuild from the written output\n');
  process.exit(1);
}
let dashboardBytes = 0;
for (const name of readdirSync(join(out, 'dashboard'))) {
  const path = join(out, 'dashboard', name);
  if (statSync(path).isFile()) dashboardBytes += statSync(path).size;
}
if (dashboardBytes > TEXT_MAX_BYTES) {
  process.stderr.write(`token radar: self-check failed: dashboard source is ${dashboardBytes} bytes, past the ${TEXT_MAX_BYTES}-byte whole-read cap\n`);
  process.exit(1);
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} early finds, ${radar.live_size} live-token protocols set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json to ${out}\n`,
);
