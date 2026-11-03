#!/usr/bin/env node
// Builds the GitHub Pages site: one page per reports/<period>/report.json, plus an index.
// Usage: node scripts/build-site.mjs [--drafts] [outDir]   (default outDir: _site)
// Reports with "draft": true are skipped unless --drafts is passed (for local previews).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml, formatDate, renderHighlights, renderReport, validateReport } from '../.agents/skills/oc-engineering-board/scripts/build-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = join(ROOT, 'reports');
const CSS = readFileSync(join(ROOT, '.agents/skills/oc-engineering-board/assets/report/style.css'), 'utf8');

// Index-only styles, on top of the shared report stylesheet.
const INDEX_CSS = `
.report-index { max-width: 820px; margin: 0 auto; }
.timeline { position: relative; list-style: none; margin: 32px 0 0; padding: 0 0 8px 32px; }
/* The rail: runs down the left edge and fades out below the oldest report. */
.timeline::before {
  content: ''; position: absolute; left: 7px; top: 6px; bottom: 0; width: 2px; border-radius: 1px;
  background: linear-gradient(to bottom, var(--border) calc(100% - 48px), transparent);
}
.timeline-item { position: relative; padding-bottom: 28px; }
.timeline-node {
  position: absolute; left: -32px; top: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: var(--bg); border: 2px solid var(--ink-3);
}
.timeline-latest .timeline-node { border-color: var(--accent); background: var(--accent); box-shadow: 0 0 0 4px var(--accent-track); }
.timeline-date { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 13px; font-weight: 500; color: var(--ink-3); }
.timeline-tag { font-size: 12px; font-weight: 600; line-height: 1.6; padding: 0 8px; border-radius: 999px; color: var(--product-ink); background: var(--product-pill); }
.timeline-draft { color: var(--ink-3); background: transparent; border: 1px solid var(--border); }
.timeline-card { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 18px 22px 16px; }
.timeline-card h2 { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 650; }
.timeline-card h2 a { color: var(--ink); }
.timeline-summary { margin: 14px 0 0; padding: 0; background: none; border-radius: 0; gap: 10px; }
.timeline-summary .hl-mark { width: 22px; height: 22px; }
.timeline-numbers { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border); color: var(--ink-3); }
.timeline-numbers strong { font-weight: 650; color: var(--ink); font-variant-numeric: tabular-nums; }
.timeline-more { display: inline-block; margin-top: 12px; font-weight: 600; }
.timeline-empty p { margin: 0; color: var(--ink-3); }
@media (max-width: 760px) {
  .timeline { padding-left: 26px; }
  .timeline::before { left: 6px; }
  .timeline-node { left: -26px; width: 14px; height: 14px; }
  .timeline-card { padding: 16px; }
}
`;

const args = process.argv.slice(2);
const includeDrafts = args.includes('--drafts');
const outDir = resolve(args.find(arg => !arg.startsWith('--')) ?? join(ROOT, '_site'));

const published = [];
let failed = false;

for (const dir of readdirSync(REPORTS, { withFileTypes: true }).filter(entry => entry.isDirectory())) {
  const file = join(REPORTS, dir.name, 'report.json');
  if (!existsSync(file)) {
    continue;
  }
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const { errors, warnings } = validateReport(report, { baseDir: join(REPORTS, dir.name) });
  warnings.forEach(warning => console.error(`warning: ${dir.name}: ${warning}`));
  if (errors.length) {
    failed = true;
    console.error(`${file} is invalid:`);
    errors.forEach(error => console.error(`  - ${error}`));
    continue;
  }
  if (report.draft && !includeDrafts) {
    console.log(`Skipped draft ${dir.name}`);
    continue;
  }
  published.push({ slug: dir.name, report, baseDir: join(REPORTS, dir.name) });
}

if (failed) {
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, '.nojekyll'), '');

for (const { slug, report, baseDir } of published) {
  mkdirSync(join(outDir, slug), { recursive: true });
  writeFileSync(join(outDir, slug, 'index.html'), renderReport(report, { css: CSS, baseDir }));
  console.log(`Wrote ${slug}/index.html`);
}

published.sort((a, b) => b.report.period.start.localeCompare(a.report.period.start));
writeFileSync(join(outDir, 'index.html'), renderIndex(published));
console.log(`Wrote index.html (${published.length} report${published.length === 1 ? '' : 's'})`);

// The index is a timeline, newest report first: a dot on a vertical rail per report, with its
// period, its highlights and a few headline numbers.
function renderIndex(items) {
  const list = items.length
    ? items.map(({ slug, report }, i) => renderTimelineEntry(slug, report, i === 0)).join('')
    : '\n    <li class="timeline-item timeline-empty"><span class="timeline-node" aria-hidden="true"></span><p>No reports published yet.</p></li>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Collective engineering reports</title>
<style>
${CSS}
${INDEX_CSS}
</style>
</head>
<body>
<main class="report report-index">
  <header class="report-header">
    <div>
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Open Collective engineering</p>
      <h1>Engineering reports</h1>
      <p class="period">What the engineering team shipped and worked on, built from the <a href="https://github.com/orgs/opencollective/projects/21">Engineering Board</a>.</p>
    </div>
  </header>
  <ol class="timeline" aria-label="Reports, newest first">${list}
  </ol>
</main>
</body>
</html>
`;
}

function renderTimelineEntry(slug, report, latest) {
  const { period, metrics } = report;
  const href = `./${escapeHtml(slug)}/`;
  const year = Number(period.end.slice(0, 4));
  const prs = metrics.prsMerged.byRepo.reduce((sum, entry) => sum + entry.value, 0);
  const numbers = [
    [report.shipped.length, 'shipped'],
    [report.inProgress.length, 'in progress'],
    [prs, prs === 1 ? 'pull request merged' : 'pull requests merged'],
  ]
    .map(([value, label]) => `<span><strong>${value.toLocaleString('en-US')}</strong> ${label}</span>`)
    .join('');
  return `
    <li class="timeline-item${latest ? ' timeline-latest' : ''}">
      <span class="timeline-node" aria-hidden="true"></span>
      <p class="timeline-date"><time datetime="${escapeHtml(period.start)}">${formatDate(period.start, year)} – ${formatDate(period.end, null)}</time>${latest ? ' <span class="timeline-tag">Latest</span>' : ''}${report.draft ? ' <span class="timeline-tag timeline-draft">Draft</span>' : ''}</p>
      <article class="timeline-card">
        <h2><a href="${href}">${escapeHtml(period.label)}</a></h2>
        ${renderHighlights(report.summary, 'summary timeline-summary')}
        <p class="timeline-numbers">${numbers}</p>
        <a class="timeline-more" href="${href}">Read the report <span aria-hidden="true">→</span></a>
      </article>
    </li>`;
}
