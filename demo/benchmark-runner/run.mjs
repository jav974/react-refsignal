#!/usr/bin/env node
// Run the automated graph benchmark across {modes × nodeCounts × repeats},
// read window.__bench__ from each page, and write results.json + results.md.
//
// Usage:
//   npm install                                  (first time)
//   node run.mjs                                 (defaults — see CONFIG)
//   node run.mjs --modes signal,jotai --nodes 500,2000 --repeats 3
//   node run.mjs --url http://localhost:5173     (reuse a running dev server)
//   node run.mjs --prod                          (vite build && vite preview)
//   node run.mjs --headed                        (show the browser window)
//
// By default the runner spawns `vite` from ../ (the demo package) and visits
// `#autobench`, matching the dev-server setup documented in docs/benchmark.md.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = resolve(__dirname, '..');
const RESULTS_DIR = resolve(__dirname, 'results');

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    modes: ['signal', 'jotai', 'zustand', 'react'],
    nodes: [200, 500, 1000, 2000],
    repeats: 1,
    autodrag: 5,
    warmup: 1500,
    // rate/escapeBatching/driveMode are arrays — cartesian-product expanded
    // at iteration time so a single invocation can cover a full matrix.
    rate: [1],
    escapeBatching: [true],
    driveMode: ['raf'],
    intervalMs: 4,
    renderer: ['svg'],
    url: null,
    prod: false,
    headed: false,
    out: 'results',
  };
  const parseBoolList = (s) =>
    s
      .split(',')
      .map((x) => x.trim().toLowerCase())
      .map((x) => x === '1' || x === 'true' || x === 'on');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--modes') args.modes = next().split(',');
    else if (a === '--nodes') args.nodes = next().split(',').map(Number);
    else if (a === '--repeats') args.repeats = +next();
    else if (a === '--autodrag') args.autodrag = +next();
    else if (a === '--warmup') args.warmup = +next();
    else if (a === '--rate') args.rate = next().split(',').map(Number);
    else if (a === '--escape') args.escapeBatching = parseBoolList(next());
    else if (a === '--no-escape-batching') args.escapeBatching = [false];
    else if (a === '--escape-batching') args.escapeBatching = [true];
    else if (a === '--drive-mode') args.driveMode = next().split(',');
    else if (a === '--interval-ms') args.intervalMs = +next();
    else if (a === '--renderer') args.renderer = next().split(',');
    else if (a === '--url') args.url = next();
    else if (a === '--prod') args.prod = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--out') args.out = next();
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          'node run.mjs [options]',
          '  --modes signal,jotai,zustand,react   (default: all 4)',
          '  --nodes 200,500,1000,2000             (default)',
          '  --repeats 1                           (default)',
          '  --autodrag 5                          (seconds, default 5)',
          '  --warmup 1500                         (ms, default 1500)',
          '  --rate 1,8,16,32                      (drives per rAF, default [1]; comma-list expands matrix)',
          '  --escape 0,1                          (flushSync on/off, default [1]; comma-list expands matrix)',
          '  --no-escape-batching                  (= --escape 0)',
          '  --escape-batching                     (= --escape 1)',
          '  --drive-mode raf,interval             (default [raf]; interval decouples drives from rAF — closer to real pointer hardware)',
          '  --interval-ms 4                       (interval-mode period; default 4 ms = 250 events/sec)',
          '  --renderer svg,canvas                 (default [svg]; canvas swaps the per-node React tree for one imperative draw loop)',
          '  --url http://localhost:5173           (reuse a running server)',
          '  --prod                                (build + preview)',
          '  --headed                              (show browser window)',
          '  --out results                         (output basename)',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return args;
}

const cfg = parseArgs(process.argv.slice(2));

// ---------------------------------------------------------------
// Vite spawn helpers
// ---------------------------------------------------------------

function spawnVite(prod) {
  const command = prod ? ['run', 'build'] : ['run', 'dev'];
  // For prod we still need a server — chain build then preview.
  if (prod) {
    return new Promise((resolveBuild, rejectBuild) => {
      console.log('▸ vite build');
      const build = spawn('npm', ['run', 'build'], {
        cwd: DEMO_DIR,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      build.on('exit', (code) => {
        if (code !== 0) {
          rejectBuild(new Error(`vite build exited ${code}`));
          return;
        }
        resolveBuild(spawnViteServer(['run', 'preview', '--', '--port', '5173']));
      });
    });
  }
  return Promise.resolve(spawnViteServer(command));
}

function spawnViteServer(npmArgs) {
  console.log(`▸ vite ${npmArgs.slice(1).join(' ')}`);
  return new Promise((resolveServer, rejectServer) => {
    const child = spawn('npm', npmArgs, {
      cwd: DEMO_DIR,
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let resolved = false;
    let buffer = '';
    const onData = (chunk) => {
      const s = chunk.toString();
      process.stdout.write(s);
      buffer += s;
      // Vite prints "Local:   http://localhost:5173/" with ANSI colour codes
      // between the label and the URL — match loosely.
      const m = buffer.match(/Local:[^\n]*?(https?:\/\/[^\s/]+)/);
      if (m && !resolved) {
        resolved = true;
        resolveServer({ child, url: m[1] });
      }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      if (!resolved)
        rejectServer(new Error(`vite exited ${code} before serving`));
    });

    // Failsafe timeout
    setTimeout(() => {
      if (!resolved) {
        child.kill();
        rejectServer(new Error('vite did not print a Local URL within 60s'));
      }
    }, 60_000);
  });
}

// ---------------------------------------------------------------
// Bench loop
// ---------------------------------------------------------------

async function runOne(
  page,
  baseUrl,
  mode,
  nodes,
  autodrag,
  warmup,
  rate,
  escapeBatching,
  driveMode,
  intervalMs,
  renderer,
) {
  const escape = escapeBatching ? 1 : 0;
  const url = `${baseUrl.replace(/\/$/, '')}/?mode=${mode}&nodes=${nodes}&autodrag=${autodrag}&warmup=${warmup}&rate=${rate}&escape=${escape}&driveMode=${driveMode}&intervalMs=${intervalMs}&renderer=${renderer}#autobench`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Total wait budget: warmup + autodrag seconds + safety margin for mount/paint.
  const timeoutMs = warmup + autodrag * 1000 + 30_000;

  const result = await page.waitForFunction(
    () => {
      const b = window.__bench__;
      return b && b.ready === true ? b : null;
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  );
  return await result.jsonValue();
}

function summarize(runs) {
  // Group by the full identity. Each tuple is a unique cell in the
  // matrix; collapsing on a smaller key would lose distinctions in a
  // multi-axis run.
  const groups = new Map();
  for (const r of runs) {
    const rateKey = r.driveMode === 'interval' ? 'NA' : String(r.rate);
    const k = `${r.renderer ?? 'svg'}|${r.driveMode}|${rateKey}|${r.escapeBatching ? 1 : 0}|${r.nodes}|${r.mode}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const rows = [];
  for (const [k, list] of groups) {
    const [renderer, driveMode, rateKey, escapeKey, nodes, mode] =
      k.split('|');
    const fpsMeans = list.map((r) => r.fpsMean);
    const fpsMedians = list.map((r) => r.fpsMedian);
    const fpsMins = list.map((r) => r.fpsMin);
    const rpsMeans = list.map((r) => r.rpsMean);
    rows.push({
      renderer,
      driveMode,
      rate: rateKey === 'NA' ? null : +rateKey,
      escapeBatching: escapeKey === '1',
      mode,
      nodes: +nodes,
      repeats: list.length,
      fpsMean: avg(fpsMeans),
      fpsMedian: avg(fpsMedians),
      fpsMin: Math.min(...fpsMins),
      rpsMean: avg(rpsMeans),
    });
  }
  rows.sort(
    (a, b) =>
      a.renderer.localeCompare(b.renderer) ||
      a.driveMode.localeCompare(b.driveMode) ||
      (a.rate ?? -1) - (b.rate ?? -1) ||
      Number(a.escapeBatching) - Number(b.escapeBatching) ||
      a.nodes - b.nodes ||
      a.mode.localeCompare(b.mode),
  );
  return rows;
}

function avg(xs) {
  return +(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(2);
}

function renderMarkdown(rows, runs, env) {
  const modeOrder = ['signal', 'jotai', 'zustand', 'react'];
  const modeLabel = {
    signal: 'RefSignal',
    jotai: 'Jotai',
    zustand: 'Zustand',
    react: 'React+memo',
  };

  const ratesEnv = Array.isArray(env.rate) ? env.rate : [env.rate];
  const escapesEnv = Array.isArray(env.escapeBatching)
    ? env.escapeBatching
    : [env.escapeBatching];
  const driveModesEnv = Array.isArray(env.driveMode)
    ? env.driveMode
    : [env.driveMode];
  const renderersEnv = Array.isArray(env.renderer)
    ? env.renderer
    : [env.renderer ?? 'svg'];

  let md = '';
  md += '# Automated benchmark results\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `- autodrag: ${env.autodrag}s · warmup: ${env.warmup}ms · repeats: ${env.repeats}\n`;
  md += `- renderers: ${renderersEnv.join(',')} · driveModes: ${driveModesEnv.join(',')} · rates (raf only): ${ratesEnv.join(',')} · escapeBatching: ${escapesEnv.map((b) => (b ? '1' : '0')).join(',')}\n`;
  md += `- intervalMs (interval mode): ${env.intervalMs}\n`;
  md += `- build: ${env.prod ? 'vite preview (prod)' : 'vite dev'}\n`;
  md += `- URL base: ${env.url}\n\n`;

  // Group rows by (driveMode, rate, escapeBatching) to produce one matrix
  // sub-table per configuration. That keeps each sub-table small and
  // readable while preserving every cell.
  const configKey = (r) =>
    `${r.renderer}|${r.driveMode}|${r.rate ?? 'NA'}|${r.escapeBatching ? 1 : 0}`;
  const byConfig = new Map();
  for (const r of rows) {
    const k = configKey(r);
    if (!byConfig.has(k))
      byConfig.set(k, {
        renderer: r.renderer,
        driveMode: r.driveMode,
        rate: r.rate,
        escapeBatching: r.escapeBatching,
        items: [],
      });
    byConfig.get(k).items.push(r);
  }

  md += `## FPS by configuration\n\n`;
  for (const cfg of byConfig.values()) {
    const driveLabel =
      cfg.driveMode === 'interval'
        ? `interval=${env.intervalMs}ms`
        : `rate=${cfg.rate}/rAF`;
    const escapeLabel = cfg.escapeBatching ? 'flushSync=on' : 'flushSync=off';
    md += `### ${cfg.renderer} · ${cfg.driveMode} · ${driveLabel} · ${escapeLabel}\n\n`;

    const byNodes = new Map();
    for (const r of cfg.items) {
      if (!byNodes.has(r.nodes)) byNodes.set(r.nodes, {});
      byNodes.get(r.nodes)[r.mode] = r;
    }

    md += `| Nodes | ${modeOrder.map((m) => modeLabel[m]).join(' | ')} | (rps below) |\n`;
    md += `|------:|${modeOrder.map(() => '------').join('|')}|------|\n`;
    for (const [n, byMode] of [...byNodes.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const fpsCells = modeOrder.map((m) =>
        byMode[m] ? byMode[m].fpsMean.toFixed(1) : '—',
      );
      md += `| ${n} fps | ${fpsCells.join(' | ')} | |\n`;
      const rpsCells = modeOrder.map((m) =>
        byMode[m] ? byMode[m].rpsMean.toFixed(0) : '—',
      );
      md += `| ${n} rps | ${rpsCells.join(' | ')} | |\n`;
    }
    md += '\n';
  }

  md += '## Full results (every cell)\n\n';
  md +=
    '| # | renderer | driveMode | rate | flushSync | Nodes | Mode | fpsMean | fpsMin | fpsMax | rpsMean |\n';
  md +=
    '|---|----------|-----------|------|-----------|------:|------|--------:|-------:|-------:|--------:|\n';
  runs.forEach((r, i) => {
    md += `| ${i + 1} | ${r.renderer ?? 'svg'} | ${r.driveMode} | ${r.driveMode === 'interval' ? '—' : r.rate} | ${r.escapeBatching ? 'on' : 'off'} | ${r.nodes} | ${r.mode} | ${r.fpsMean.toFixed(2)} | ${r.fpsMin} | ${r.fpsMax} | ${r.rpsMean.toFixed(2)} |\n`;
  });

  return md;
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  let viteChild = null;
  let baseUrl = cfg.url;

  if (!baseUrl) {
    const { child, url } = await spawnVite(cfg.prod);
    viteChild = child;
    baseUrl = url;
  }

  const cleanup = () => {
    if (viteChild && !viteChild.killed) {
      console.log('▸ stopping vite');
      viteChild.kill();
    }
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  const browser = await chromium.launch({ headless: !cfg.headed });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  // Cartesian product: every (rep, renderer, driveMode, rate,
  // escapeBatching, nodes, mode) tuple. For driveMode='interval' the rate
  // dimension collapses to a single value (interval ignores rate) — avoids
  // redundant cells.
  const cells = [];
  for (let rep = 0; rep < cfg.repeats; rep++) {
    for (const renderer of cfg.renderer) {
      for (const driveMode of cfg.driveMode) {
        const ratesForMode =
          driveMode === 'interval' ? [cfg.rate[0]] : cfg.rate;
        for (const rate of ratesForMode) {
          for (const escapeBatching of cfg.escapeBatching) {
            for (const nodes of cfg.nodes) {
              for (const mode of cfg.modes) {
                cells.push({
                  rep,
                  renderer,
                  driveMode,
                  rate,
                  escapeBatching,
                  nodes,
                  mode,
                });
              }
            }
          }
        }
      }
    }
  }
  const total = cells.length;
  let done = 0;
  const runs = [];

  try {
    for (const cell of cells) {
      done++;
      const driveTag =
        cell.driveMode === 'interval'
          ? `interval=${cfg.intervalMs}ms`
          : `rate=${cell.rate}`;
      const escapeTag = cell.escapeBatching ? 'flushSync' : 'batched';
      process.stdout.write(
        `[${done}/${total}] ${cell.renderer} mode=${cell.mode} nodes=${cell.nodes} ${driveTag} ${escapeTag} rep=${cell.rep + 1}/${cfg.repeats} ... `,
      );
      const t0 = Date.now();
      try {
        const r = await runOne(
          page,
          baseUrl,
          cell.mode,
          cell.nodes,
          cfg.autodrag,
          cfg.warmup,
          cell.rate,
          cell.escapeBatching,
          cell.driveMode,
          cfg.intervalMs,
          cell.renderer,
        );
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(
          `fps=${r.fpsMean.toFixed(1)} rps=${r.rpsMean.toFixed(0)} (${dt}s)`,
        );
        runs.push(r);
      } catch (err) {
        console.log(`FAILED — ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    cleanup();
  }

  const summary = summarize(runs);
  const env = {
    autodrag: cfg.autodrag,
    warmup: cfg.warmup,
    rate: cfg.rate,
    escapeBatching: cfg.escapeBatching,
    driveMode: cfg.driveMode,
    intervalMs: cfg.intervalMs,
    renderer: cfg.renderer,
    repeats: cfg.repeats,
    prod: cfg.prod,
    url: baseUrl,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const jsonPath = resolve(RESULTS_DIR, `${cfg.out}.json`);
  const mdPath = resolve(RESULTS_DIR, `${cfg.out}.md`);
  await writeFile(
    jsonPath,
    JSON.stringify({ env, summary, runs }, null, 2),
  );
  await writeFile(mdPath, renderMarkdown(summary, runs, env));

  console.log(`\n▸ wrote ${jsonPath}`);
  console.log(`▸ wrote ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
