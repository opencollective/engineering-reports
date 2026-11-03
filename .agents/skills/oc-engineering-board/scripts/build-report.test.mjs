import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderReport, richText, shortRef, validateReport } from './build-report.mjs';

const example = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report', 'example.json'), 'utf8'),
);
const clone = () => structuredClone(example);

// 1x1 transparent PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

test('the example report is valid and renders every section', () => {
  assert.deepEqual(validateReport(example), { errors: [], warnings: [] });
  const html = renderReport(example);
  for (const id of ['shipped', 'in-progress', 'ongoing', 'next', 'misc']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`class="toc-section" href="#${id}"`), `outline links to ${id}`);
  }
  assert.match(html, /<title>Engineering report: October 2026<\/title>/);
  assert.match(html, /<style>\n[\s\S]*--ink:/, 'inlines the shared stylesheet');
  assert.doesNotMatch(html, /<link|<script src|src="http/, 'stays self-contained');
  assert.doesNotMatch(html, /Generated/);
});

test('the outline lists only the top-level sections', () => {
  const html = renderReport(example);
  const outline = html.slice(html.indexOf('<nav class="toc"'), html.indexOf('</nav>'));
  const links = [...outline.matchAll(/class="toc-section" href="#([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, ['numbers', 'highlights', 'shipped', 'in-progress', 'ongoing', 'next', 'misc']);
  assert.doesNotMatch(outline, /#item-|#misc-/);
});

test('areas follow the board order', () => {
  const html = renderReport(example);
  const shipped = html.slice(html.indexOf('id="shipped"'), html.indexOf('id="in-progress"'));
  const order = [...shipped.matchAll(/<span class="pill [^"]+">([^<]+)</g)].map(m => m[1].replace('&amp;', '&'));
  assert.deepEqual(order, ['Security', 'Payment processors', 'Improvements', 'Compliance', 'Testing & CI']);
});

test('stats show merged pull requests per repository and no removed metrics', () => {
  const html = renderReport(example);
  assert.match(html, /<p class="tile-value">135</, 'total is the sum of the repositories');
  assert.match(html, />API<\/a>[\s\S]*>Frontend<\/a>[\s\S]*>PDF<\/a>/, 'repositories sorted by count');
  assert.match(
    html,
    /href="https:\/\/github.com\/opencollective\/opencollective-api\/pulls\?q=is%3Apr\+is%3Amerged\+merged%3A2026-10-01..2026-10-31\+-author%3Aapp%2Frenovate\+-author%3Aapp%2Fdependabot"/,
    'each repository links to its merged pull requests for the period',
  );
  assert.match(html, /<span class="issue-label"><svg class="octicon[^>]*>.*?<\/svg>Closed<\/span>\s*<span class="tile-value">118/);
  assert.match(html, /<span class="issue-label"><svg class="octicon[^>]*>.*?<\/svg>Opened<\/span>\s*<span class="tile-value">104/);
  assert.match(html, /issues\?q=is%3Aissue\+created%3A2026-10-01..2026-10-31/);
  assert.doesNotMatch(html, /Contributors|Projects shipped/);
  const report = clone();
  report.metrics.contributors = { value: 4 };
  report.metrics.issuesClosed = { value: 4 };
  delete report.metrics.issues.opened;
  const { errors } = validateReport(report);
  assert.ok(errors.includes('metrics.contributors is no longer reported; remove it'));
  assert.ok(errors.includes('metrics.issuesClosed is no longer reported; remove it (use metrics.issues)'));
  assert.ok(errors.includes('metrics.issues.opened.value must be a non-negative integer'));
});

test('highlights are bullet points, and long ones warn', () => {
  assert.match(renderReport(example), /<ul class="summary"><li><span class="hl-mark hl-0"/);
  const report = clone();
  report.summary = Array(6).fill('x'.repeat(200));
  const { errors, warnings } = validateReport(report);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(w => w.includes('6 bullets')));
  assert.ok(warnings.some(w => w.includes('summary[0] is 200 characters')));
});

test('scope flags decide which sections exist', () => {
  const report = clone();
  report.scope = { ...report.scope, inProgress: false, offBoard: false };
  delete report.inProgress;
  delete report.next;
  delete report.misc;
  assert.deepEqual(validateReport(report).errors, []);
  const html = renderReport(report);
  assert.doesNotMatch(html, /id="in-progress"|id="next"|id="misc"/);
  assert.match(html, /id="ongoing"/, 'ongoing work does not depend on scope.inProgress');
});

test('empty sections are left out, header links included', () => {
  const report = clone();
  report.next = [];
  delete report.ongoing;
  assert.deepEqual(validateReport(report).errors, []);
  const html = renderReport(report);
  assert.doesNotMatch(html, /id="next"|href="#next"|id="ongoing"|href="#ongoing"/);
});

test('sections must match the scope flags', () => {
  const report = clone();
  report.scope.offBoard = false;
  report.scope.inProgress = false;
  const { errors } = validateReport(report);
  assert.ok(errors.includes('misc must be omitted when scope.offBoard is false'));
  assert.ok(errors.includes('next must be omitted when scope.inProgress is false'));
});

test('validation reports malformed fields', () => {
  const report = clone();
  report.period.start = '2026-11-01';
  report.shipped[0].subIssues = { done: 6, total: 5 };
  report.misc[0].kind = 'chore';
  report.metrics.prsMerged.byRepo[0].previous = -1;
  report.ongoing[0].done[1].links = ['https://github.com/opencollective/opencollective-api/pull/1'];
  report.inProgress[0].done = [];
  const { errors } = validateReport(report);
  assert.ok(errors.includes('period.start must not be after period.end'));
  assert.ok(errors.includes('shipped[0].subIssues must be { done, total } with done <= total'));
  assert.ok(errors.includes('misc[0].kind must be "fix" or "improvement"'));
  assert.ok(errors.includes('metrics.prsMerged.byRepo[0].previous must be a non-negative integer'));
  assert.ok(errors.includes('ongoing[0].done[1] takes either url or links (two or more pull requests), not both'));
  assert.ok(errors.includes('inProgress[0].done is only for ongoing items'));
});

test('draft is an optional boolean', () => {
  const report = clone();
  report.draft = true;
  assert.deepEqual(validateReport(report).errors, []);
  report.draft = 'yes';
  assert.ok(validateReport(report).errors.includes('draft must be true or false'));
});

test('unknown areas warn and render neutral', () => {
  const report = clone();
  report.shipped[0].area = 'Quantum';
  const { errors, warnings } = validateReport(report);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(renderReport(report), /card card-tinted area-other/);
});

test('quick filters appear only where a section mixes areas', () => {
  const html = renderReport(example);
  assert.match(html, /id="filter-shipped-compliance"/, 'shipped mixes five areas');
  assert.doesNotMatch(html, /id="filter-in-progress-/, 'two items are not worth filtering');
  assert.match(html, /id="filter-misc-fix"[\s\S]*id="filter-misc-improvement"/, 'misc filters by kind');
  assert.match(html, /#shipped:has\(#filter-shipped-compliance:checked\) \[data-filter\]:not\(\[data-filter="compliance"\]\)/);
});

test('ongoing items show figures and breakdowns for the period', () => {
  const html = renderReport(example);
  assert.match(html, /<dt>Reports received<\/dt><dd>12<\/dd>/);
  assert.match(html, /<p class="breakdown-title">Reports received, by source<\/p><ul><li>Bug bounty<span class="count">9<\/span>/);
  const report = clone();
  report.shipped[0].figures = [{ label: 'x', value: 1 }];
  report.ongoing[1].breakdowns = [{ title: 'By area', entries: [] }];
  const { errors } = validateReport(report);
  assert.ok(errors.includes('shipped[0].figures is only for ongoing items'));
  assert.ok(errors.includes('ongoing[1].breakdowns[0].entries must be a non-empty array of { label, value }'));
});

test('items can have short points and a next step', () => {
  const report = clone();
  report.inProgress[0].points = ['Gift cards', '**Account following**'];
  report.inProgress[0].upNext = 'Prepaid payment methods';
  report.inProgress[0].summary = 'x'.repeat(170);
  const { errors, warnings } = validateReport(report);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(w => w.includes('inProgress[0].summary is 170 characters')));
  const html = renderReport(report);
  assert.match(html, /<ul class="points"><li>Gift cards<\/li><li><strong>Account following<\/strong><\/li><\/ul>/);
  assert.match(html, /<p class="up-next"><span class="up-next-label">Next<\/span><span>Prepaid payment methods<\/span><\/p>/);
  report.inProgress[0].points = [];
  assert.ok(validateReport(report).errors.includes('inProgress[0].points must be a non-empty array of short strings'));
});

test('misc entries are grouped by topic, all or none', () => {
  const html = renderReport(example);
  assert.match(html, /<h3>Expenses<span class="count">2<\/span><\/h3>/);
  const report = clone();
  delete report.misc[0].topic;
  assert.ok(validateReport(report).errors.includes('misc entries must all have a topic, or none'));
});

test('**keywords** become bold, after escaping', () => {
  assert.equal(richText('**New pricing** & <b>tips</b>'), '<strong>New pricing</strong> &amp; &lt;b&gt;tips&lt;/b&gt;');
});

test('GitHub handles link to profiles', () => {
  const html = renderReport(example);
  assert.match(html, /<a class="handle" href="https:\/\/github.com\/kewitz">@kewitz<\/a>/);
  assert.equal(richText('by @Betree.'), 'by <a class="handle" href="https://github.com/Betree">@Betree</a>.');
  assert.equal(richText('mail me@example.com'), 'mail me@example.com', 'leaves email addresses alone');
});

test('images are read relative to the report and inlined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  writeFileSync(join(dir, 'shot.png'), PNG);
  const report = clone();
  report.shipped[0].images = [{ src: 'shot.png', alt: 'The tax form', caption: 'By @kewitz' }];
  assert.deepEqual(validateReport(report, { baseDir: dir }).errors, []);
  const html = renderReport(report, { baseDir: dir });
  assert.match(html, /<img src="data:image\/png;base64,iVBOR[^"]*" alt="The tax form"/);
  assert.match(html, /class="card card-tinted area-trust card-wide"/);

  report.shipped[0].images = [{ src: 'missing.png', alt: 'x' }, { src: 'https://example.com/a.png', alt: 'x' }];
  const { errors } = validateReport(report, { baseDir: dir });
  assert.ok(errors.includes('shipped[0].images[0].src missing.png does not exist'));
  assert.ok(errors.includes('shipped[0].images[1].src must be a path relative to report.json (no URLs)'));
});

test('text is escaped and cross-repo references become links', () => {
  assert.equal(
    richText('<b>x</b> see opencollective/opencollective-api#12'),
    '&lt;b&gt;x&lt;/b&gt; see <a href="https://github.com/opencollective/opencollective-api/issues/12">opencollective/opencollective-api#12</a>',
  );
  const report = clone();
  report.shipped[0].title = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(renderReport(report), /<img src=x/);
});

test('short references drop the main tracker name', () => {
  assert.equal(shortRef('https://github.com/opencollective/opencollective/issues/8101'), '#8101');
  assert.equal(shortRef('https://github.com/opencollective/opencollective-api/pull/12'), 'opencollective-api#12');
});
