#!/usr/bin/env node
// Reads results-full-matrix.json and writes a self-contained MD report
// with run metadata, library versions, every cross-section table, the
// flat 80-row results table, and collapsible per-cell sample tables.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const data = JSON.parse(
  readFileSync(resolve(RESULTS_DIR, 'results-full-matrix.json'), 'utf8'),
);
const demoPkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
);
const libPkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
);
const versions = {
  refsignal: libPkg.version,
  react: requireVersion('react'),
  jotai: requireVersion('jotai'),
  zustand: requireVersion('zustand'),
  vite: requireVersion('vite'),
};

function requireVersion(name) {
  try {
    const pkg = JSON.parse(
      readFileSync(
        resolve(__dirname, '..', 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    return pkg.version;
  } catch {
    return demoPkg.dependencies?.[name] ?? demoPkg.devDependencies?.[name];
  }
}

const MODE_LABEL = {
  signal: 'RefSignal',
  jotai: 'Jotai',
  zustand: 'Zustand',
  react: 'React+memo',
};
const MODE_ORDER = ['signal', 'jotai', 'zustand', 'react'];

const cells = data.runs;

function configLabel(r) {
  const drive =
    r.driveMode === 'interval'
      ? `interval=${data.env.intervalMs}ms`
      : `rate=${r.rate}/rAF`;
  const escape = r.escapeBatching ? 'flushSync' : 'batched';
  return `${drive}, ${escape}`;
}

function cellKey(r) {
  return `${r.driveMode}|${r.driveMode === 'interval' ? 'na' : r.rate}|${r.escapeBatching ? 1 : 0}|${r.nodes}|${r.mode}`;
}

// Cross-section: rows = nodes, cols = modes, scoped to a config group.
function fpsTable(filter) {
  const matches = cells.filter(filter);
  if (matches.length === 0) return '_(no cells)_\n';
  const byNodes = new Map();
  for (const r of matches) {
    if (!byNodes.has(r.nodes)) byNodes.set(r.nodes, {});
    byNodes.get(r.nodes)[r.mode] = r;
  }
  let md = `| Nodes | ${MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ')} |\n`;
  md += `|------:|${MODE_ORDER.map(() => '------:').join('|')}|\n`;
  for (const [n, byMode] of [...byNodes.entries()].sort((a, b) => a[0] - b[0])) {
    md += `| ${n} fps | ${MODE_ORDER.map((m) =>
      byMode[m] ? byMode[m].fpsMean.toFixed(1) : '—',
    ).join(' | ')} |\n`;
    md += `| ${n} rps | ${MODE_ORDER.map((m) =>
      byMode[m] ? byMode[m].rpsMean.toFixed(0) : '—',
    ).join(' | ')} |\n`;
  }
  return md + '\n';
}

let md = '';

md += '# Full matrix benchmark — every (drive × rate × escape × mode × nodes) cell\n\n';
md += `Generated: ${new Date().toISOString()}\n\n`;
md += 'Self-contained report. JSON companion: [`results-full-matrix.json`](./results-full-matrix.json).\n\n';

md += '## Run metadata\n\n';
md += `| | |\n|---|---|\n`;
md += `| Bench source | [\`demo/graph-benchmark-automated.tsx\`](../../graph-benchmark-automated.tsx) |\n`;
md += `| Runner | [\`demo/benchmark-runner/run.mjs\`](../run.mjs) |\n`;
md += `| Browser | Linux Chromium 148.0.7778.96 (Playwright chromium-1223) |\n`;
md += `| Browser mode | Headed (window visible via WSLg) |\n`;
md += `| Hardware | AMD Ryzen AI 9 HX 370, 24 logical cores, on AC power |\n`;
md += `| OS | WSL2 + WSLg on Windows 11 |\n`;
md += `| Display path | WSLg virtualization → Wayland → RDP (paint pipeline is virtualized) |\n`;
md += `| Build | Vite dev server (\`npm run dev\`) |\n`;
md += `| React StrictMode | off |\n`;
md += `| Devtools mount | skipped for autobench route |\n\n`;

md += '## Library versions (resolved)\n\n';
md += `| Library | Resolved |\n|---|---|\n`;
md += `| react-refsignal | ${versions.refsignal} (workspace, via vite alias to \`../src\`) |\n`;
md += `| react / react-dom | ${versions.react} |\n`;
md += `| jotai | ${versions.jotai} |\n`;
md += `| zustand | ${versions.zustand} |\n`;
md += `| vite | ${versions.vite} |\n\n`;

md += '## Bench knobs\n\n';
md += `| Knob | Values | Cardinality |\n|---|---|---|\n`;
md += `| nodes | 1000, 2000 | 2 |\n`;
md += `| mode | signal, jotai, zustand, react | 4 |\n`;
md += `| driveMode | raf, interval | 2 |\n`;
md += `| rate | ${data.env.rate.join(', ')} (raf only; ignored for interval) | 4 (raf) / 1 (interval) |\n`;
md += `| escapeBatching (flushSync) | false, true | 2 |\n`;
md += `| intervalMs (interval mode) | ${data.env.intervalMs} | — |\n`;
md += `| durationSec | ${data.env.autodrag} | — |\n`;
md += `| warmupMs | ${data.env.warmup} | — |\n`;
md += `| SWEEP_RADIUS | 200 SVG units | — |\n`;
md += `| SWEEP_VELOCITY | 6 rad/sec | — |\n\n`;
md += `**Total cells:** ${cells.length} (raf: 4×2×4×2 = 64 + interval: 1×2×4×2 = 16)\n\n`;
md += `**Wall time:** ~16 minutes total (~${(cells.reduce((s) => s + 12, 0) / 60).toFixed(1)} min × ~12 s/cell)\n\n`;

md += '---\n\n';
md += '## Headline cross-sections\n\n';

md += '### RAF mode — rate=1\n\n';
md += '**Batched (no flushSync):**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 1 && !r.escapeBatching,
);
md += '**flushSync:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 1 && r.escapeBatching,
);

md += '### RAF mode — rate=8\n\n';
md += '**Batched:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 8 && !r.escapeBatching,
);
md += '**flushSync:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 8 && r.escapeBatching,
);

md += '### RAF mode — rate=16\n\n';
md += '**Batched:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 16 && !r.escapeBatching,
);
md += '**flushSync:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 16 && r.escapeBatching,
);

md += '### RAF mode — rate=32\n\n';
md += '**Batched:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 32 && !r.escapeBatching,
);
md += '**flushSync:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'raf' && r.rate === 32 && r.escapeBatching,
);

md += '### Interval mode (intervalMs=1, ~self-throttled)\n\n';
md += '**Batched:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'interval' && !r.escapeBatching,
);
md += '**flushSync:**\n\n';
md += fpsTable(
  (r) => r.driveMode === 'interval' && r.escapeBatching,
);

md += '---\n\n';
md += '## Effect analyses\n\n';

// Rate scaling effect — pivot by rate, fixed (escape=on, mode, nodes)
md += '### FPS vs rate (raf mode, flushSync on, by mode @ 2000 nodes)\n\n';
md += '| Rate | ' + MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ') + ' |\n';
md += '|---:|' + MODE_ORDER.map(() => '------:').join('|') + '|\n';
for (const rate of data.env.rate) {
  const cellsAt = MODE_ORDER.map((m) =>
    cells.find(
      (r) =>
        r.driveMode === 'raf' &&
        r.rate === rate &&
        r.escapeBatching &&
        r.nodes === 2000 &&
        r.mode === m,
    ),
  );
  md += `| ${rate} | ${cellsAt
    .map((c) => (c ? c.fpsMean.toFixed(1) : '—'))
    .join(' | ')} |\n`;
}
md += '\n';

md += '### FPS vs rate (raf mode, flushSync on, by mode @ 1000 nodes)\n\n';
md += '| Rate | ' + MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ') + ' |\n';
md += '|---:|' + MODE_ORDER.map(() => '------:').join('|') + '|\n';
for (const rate of data.env.rate) {
  const cellsAt = MODE_ORDER.map((m) =>
    cells.find(
      (r) =>
        r.driveMode === 'raf' &&
        r.rate === rate &&
        r.escapeBatching &&
        r.nodes === 1000 &&
        r.mode === m,
    ),
  );
  md += `| ${rate} | ${cellsAt
    .map((c) => (c ? c.fpsMean.toFixed(1) : '—'))
    .join(' | ')} |\n`;
}
md += '\n';

// flushSync effect: same config, compare on/off
md += '### Effect of flushSync (raf mode, by rate × mode @ 2000 nodes)\n\n';
md += 'FPS — batched / flushSync. Lower with flushSync = React batching was helping that mode.\n\n';
md += '| Rate | ' + MODE_ORDER.map((m) => MODE_LABEL[m]).join(' | ') + ' |\n';
md += '|---:|' + MODE_ORDER.map(() => '---').join('|') + '|\n';
for (const rate of data.env.rate) {
  const row = MODE_ORDER.map((m) => {
    const batched = cells.find(
      (r) =>
        r.driveMode === 'raf' &&
        r.rate === rate &&
        !r.escapeBatching &&
        r.nodes === 2000 &&
        r.mode === m,
    );
    const flushed = cells.find(
      (r) =>
        r.driveMode === 'raf' &&
        r.rate === rate &&
        r.escapeBatching &&
        r.nodes === 2000 &&
        r.mode === m,
    );
    if (!batched || !flushed) return '—';
    return `${batched.fpsMean.toFixed(0)} / ${flushed.fpsMean.toFixed(0)}`;
  });
  md += `| ${rate} | ${row.join(' | ')} |\n`;
}
md += '\n';

// raf vs interval
md += '### raf rate=1 vs interval=1ms (both flushSync on)\n\n';
md += '| Nodes | Mode | raf rate=1 | interval=1ms | Δ |\n';
md += '|---:|---|---:|---:|---:|\n';
for (const n of [1000, 2000]) {
  for (const m of MODE_ORDER) {
    const raf = cells.find(
      (r) =>
        r.driveMode === 'raf' &&
        r.rate === 1 &&
        r.escapeBatching &&
        r.nodes === n &&
        r.mode === m,
    );
    const itv = cells.find(
      (r) =>
        r.driveMode === 'interval' &&
        r.escapeBatching &&
        r.nodes === n &&
        r.mode === m,
    );
    if (!raf || !itv) continue;
    const delta = (itv.fpsMean - raf.fpsMean).toFixed(1);
    md += `| ${n} | ${MODE_LABEL[m]} | ${raf.fpsMean.toFixed(1)} | ${itv.fpsMean.toFixed(1)} | ${delta} |\n`;
  }
}
md += '\n';

md += '---\n\n';
md += '## Full results table (80 cells)\n\n';
md += '| # | driveMode | rate | flushSync | nodes | mode | fpsMean | fpsMin | fpsMax | rpsMean |\n';
md += '|---|---|---:|---|---:|---|---:|---:|---:|---:|\n';
const sorted = [...cells].sort((a, b) => {
  if (a.driveMode !== b.driveMode) return a.driveMode.localeCompare(b.driveMode);
  if (a.rate !== b.rate) return (a.rate ?? 0) - (b.rate ?? 0);
  if (a.escapeBatching !== b.escapeBatching) return Number(a.escapeBatching) - Number(b.escapeBatching);
  if (a.nodes !== b.nodes) return a.nodes - b.nodes;
  return MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode);
});
sorted.forEach((r, i) => {
  md += `| ${i + 1} | ${r.driveMode} | ${r.driveMode === 'interval' ? '—' : r.rate} | ${r.escapeBatching ? 'on' : 'off'} | ${r.nodes} | ${MODE_LABEL[r.mode]} | ${r.fpsMean.toFixed(2)} | ${r.fpsMin} | ${r.fpsMax} | ${r.rpsMean.toFixed(0)} |\n`;
});
md += '\n---\n\n';

md += '## Per-cell sample detail\n\n';
md += '9 one-second samples per cell. Collapsed by default.\n\n';
for (const r of sorted) {
  const label = `${MODE_LABEL[r.mode]} · nodes=${r.nodes} · ${configLabel(r)}`;
  md += `<details><summary><b>${label}</b> — fpsMean=${r.fpsMean.toFixed(1)} fpsMin=${r.fpsMin} fpsMax=${r.fpsMax} rpsMean=${r.rpsMean.toFixed(0)}</summary>\n\n`;
  md += '| tSec | fps | rps |\n|---:|---:|---:|\n';
  for (const s of r.samples) {
    md += `| ${s.tSec} | ${s.fps} | ${s.rps} |\n`;
  }
  md += '\n</details>\n\n';
}

md += '---\n\n';
md += '## How to reproduce\n\n';
md += '```bash\n';
md += 'cd demo/benchmark-runner\n';
md += 'npm install   # one-time\n';
md += 'node run.mjs --headed --nodes 1000,2000 \\\n';
md += '             --rate 1,8,16,32 --escape 0,1 \\\n';
md += '             --drive-mode raf,interval --interval-ms 1 \\\n';
md += '             --out results-full-matrix\n';
md += '```\n\n';
md += 'See [`COMPARISON.md`](./COMPARISON.md) for the cross-methodology synthesis.\n';

const out = resolve(RESULTS_DIR, 'results-full-matrix-detailed.md');
writeFileSync(out, md);
console.log('wrote', out, `(${md.length} chars)`);
