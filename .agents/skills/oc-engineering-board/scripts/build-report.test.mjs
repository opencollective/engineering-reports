import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderReport, richText, shortRef, validateReport } from './build-report.mjs';

const example = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report', 'example.json'), 'utf8'),
);
const clone = () => structuredClone(example);

test('the example report is valid and renders every section', () => {
  assert.deepEqual(validateReport(example), { errors: [], warnings: [] });
  const html = renderReport(example);
  for (const id of ['shipped', 'in-progress', 'next', 'misc']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<title>Engineering report: October 2026<\/title>/);
  assert.match(html, /<style>\n[\s\S]*--ink:/, 'inlines the shared stylesheet');
  assert.doesNotMatch(html, /<link|<script|src="http/, 'stays self-contained');
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
});

test('sections must match the scope flags', () => {
  const report = clone();
  report.scope.offBoard = false;
  delete report.next;
  const { errors } = validateReport(report);
  assert.ok(errors.includes('misc must be omitted when scope.offBoard is false'));
  assert.ok(errors.includes('next must be an array'));
});

test('validation reports malformed fields', () => {
  const report = clone();
  report.period.start = '2026-11-01';
  report.shipped[0].subIssues = { done: 6, total: 5 };
  report.misc[0].kind = 'chore';
  report.metrics.prsMerged.previous = -1;
  const { errors } = validateReport(report);
  assert.ok(errors.includes('period.start must not be after period.end'));
  assert.ok(errors.includes('shipped[0].subIssues must be { done, total } with done <= total'));
  assert.ok(errors.includes('misc[0].kind must be "fix" or "improvement"'));
  assert.ok(errors.includes('metrics.prsMerged.previous must be a non-negative integer'));
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

test('text is escaped and cross-repo references become links', () => {
  assert.equal(
    richText('<b>x</b> see opencollective/opencollective-api#12'),
    '&lt;b&gt;x&lt;/b&gt; see <a href="https://github.com/opencollective/opencollective-api/issues/12">opencollective/opencollective-api#12</a>',
  );
  const report = clone();
  report.shipped[0].title = '<img src=x onerror=alert(1)>';
  assert.doesNotMatch(renderReport(report), /<img/);
});

test('short references drop the main tracker name', () => {
  assert.equal(shortRef('https://github.com/opencollective/opencollective/issues/8101'), '#8101');
  assert.equal(shortRef('https://github.com/opencollective/opencollective-api/pull/12'), 'opencollective-api#12');
});
