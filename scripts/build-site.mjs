#!/usr/bin/env node
// Builds the GitHub Pages site: one page per reports/<period>/report.json, plus an index.
// Usage: node scripts/build-site.mjs [--drafts] [outDir]   (default outDir: _site)
// Reports with "draft": true are skipped unless --drafts is passed (for local previews).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { escapeHtml, renderReport, validateReport } from '../.agents/skills/oc-engineering-board/scripts/build-report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = join(ROOT, 'reports');
const CSS = readFileSync(join(ROOT, '.agents/skills/oc-engineering-board/assets/report/style.css'), 'utf8');

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
  const { errors, warnings } = validateReport(report);
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
  published.push({ slug: dir.name, report });
}

if (failed) {
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, '.nojekyll'), '');

for (const { slug, report } of published) {
  mkdirSync(join(outDir, slug), { recursive: true });
  writeFileSync(join(outDir, slug, 'index.html'), renderReport(report, CSS));
  console.log(`Wrote ${slug}/index.html`);
}

published.sort((a, b) => b.report.period.start.localeCompare(a.report.period.start));
writeFileSync(join(outDir, 'index.html'), renderIndex(published));
console.log(`Wrote index.html (${published.length} report${published.length === 1 ? '' : 's'})`);

function renderIndex(items) {
  const list = items.length
    ? items
        .map(
          ({ slug, report }) => `
      <li>
        <a href="./${escapeHtml(slug)}/">${escapeHtml(report.period.label)}</a>${report.draft ? ' <span class="index-draft">Draft</span>' : ''}
        <p>${escapeHtml(report.summary[0])}</p>
      </li>`,
        )
        .join('')
    : '\n      <li><p>No reports published yet.</p></li>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Collective engineering reports</title>
<style>
${CSS}
.index-list { list-style: none; margin: 24px 0 0; padding: 0; display: grid; gap: 12px; }
.index-list li { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: 16px 20px; }
.index-list a { font-weight: 600; font-size: 1.05rem; color: var(--link); text-decoration: none; }
.index-list a:hover { text-decoration: underline; }
.index-list p { margin: 6px 0 0; color: var(--ink-2); }
.index-draft { font-size: 0.75rem; color: var(--ink-3); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; margin-left: 6px; }
</style>
</head>
<body>
<main class="report">
  <header class="report-header">
    <div>
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Open Collective engineering</p>
      <h1>Engineering reports</h1>
      <p class="period">What the engineering team shipped and worked on, built from the <a href="https://github.com/orgs/opencollective/projects/21">Engineering Board</a>.</p>
    </div>
  </header>
  <ul class="index-list">${list}
  </ul>
</main>
</body>
</html>
`;
}
