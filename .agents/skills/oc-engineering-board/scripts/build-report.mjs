#!/usr/bin/env node
// Renders an engineering period report from report.json into one self-contained HTML file.
// Usage: node build-report.mjs <report.json> [out.html]   (default: report.html beside the JSON)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report');
const BOARD_URL = 'https://github.com/orgs/opencollective/projects/21';

// Engineering Area options, in report order, with the color family each one uses.
export const AREAS = [
  ['Improvements', 'product'],
  ['Payment processors', 'product'],
  ['Support', 'product'],
  ['Bug fixes', 'bugs'],
  ['Security', 'trust'],
  ['Compliance', 'trust'],
  ['Reliability & monitoring', 'reliability'],
  ['Resilience & recovery', 'reliability'],
  ['Platform maintenance', 'foundations'],
  ['Technical debt', 'foundations'],
  ['Testing & CI', 'dx'],
  ['Developer experience', 'dx'],
];
const AREA_FAMILY = new Map(AREAS);
const AREA_ORDER = new Map(AREAS.map(([name], index) => [name, index]));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Validation

export function validateReport(report) {
  const errors = [];
  const warnings = [];
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isCount = value => Number.isInteger(value) && value >= 0;
  const requireString = (value, path) => {
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`${path} must be a non-empty string`);
    }
  };
  const requireDate = (value, path, optional = false) => {
    if (optional && value === undefined) {
      return;
    }
    if (typeof value !== 'string' || !ISO_DATE.test(value)) {
      errors.push(`${path} must be an ISO date (YYYY-MM-DD)`);
    }
  };

  if (!isObject(report)) {
    return { errors: ['report must be a JSON object'], warnings };
  }

  if (!isObject(report.period)) {
    errors.push('period is required');
  } else {
    requireString(report.period.label, 'period.label');
    requireDate(report.period.start, 'period.start');
    requireDate(report.period.end, 'period.end');
    if (report.period.start > report.period.end) {
      errors.push('period.start must not be after period.end');
    }
  }
  requireDate(report.generatedOn, 'generatedOn');
  if (report.draft !== undefined && typeof report.draft !== 'boolean') {
    errors.push('draft must be true or false');
  }

  const scope = report.scope;
  if (!isObject(scope)) {
    errors.push('scope is required');
  } else {
    for (const flag of ['inProgress', 'offBoard']) {
      if (typeof scope[flag] !== 'boolean') {
        errors.push(`scope.${flag} must be true or false`);
      }
    }
    if (!Array.isArray(scope.repos) || scope.repos.length === 0 || !scope.repos.every(r => /^[\w.-]+\/[\w.-]+$/.test(r))) {
      errors.push('scope.repos must list owner/repo names');
    }
  }

  if (!Array.isArray(report.summary) || report.summary.length === 0) {
    errors.push('summary must be a non-empty array of paragraphs');
  } else {
    report.summary.forEach((paragraph, i) => requireString(paragraph, `summary[${i}]`));
  }

  const metrics = report.metrics;
  if (!isObject(metrics)) {
    errors.push('metrics is required');
  } else {
    let hasPrevious = false;
    for (const key of ['prsMerged', 'issuesClosed', 'contributors']) {
      const metric = metrics[key];
      if (!isObject(metric) || !isCount(metric.value)) {
        errors.push(`metrics.${key}.value must be a non-negative integer`);
        continue;
      }
      if (metric.previous !== undefined) {
        hasPrevious = true;
        if (!isCount(metric.previous)) {
          errors.push(`metrics.${key}.previous must be a non-negative integer`);
        }
      }
    }
    if (metrics.shippedPrevious !== undefined) {
      hasPrevious = true;
      if (!isCount(metrics.shippedPrevious)) {
        errors.push('metrics.shippedPrevious must be a non-negative integer');
      }
    }
    if (hasPrevious) {
      requireString(metrics.previousLabel, 'metrics.previousLabel');
    }
  }

  const validateItems = (items, path) => {
    if (!Array.isArray(items)) {
      errors.push(`${path} must be an array`);
      return;
    }
    items.forEach((item, i) => {
      const at = `${path}[${i}]`;
      if (!isObject(item)) {
        errors.push(`${at} must be an object`);
        return;
      }
      requireString(item.title, `${at}.title`);
      requireString(item.url, `${at}.url`);
      requireString(item.area, `${at}.area`);
      if (typeof item.area === 'string' && !AREA_FAMILY.has(item.area)) {
        warnings.push(`${at}.area "${item.area}" is not a known Engineering Area; rendered in neutral colors (update AREAS in build-report.mjs if the board gained an area)`);
      }
      if (item.summary !== undefined) {
        requireString(item.summary, `${at}.summary`);
      }
      requireDate(item.start, `${at}.start`, true);
      requireDate(item.end, `${at}.end`, true);
      if (item.subIssues !== undefined) {
        const { done, total } = isObject(item.subIssues) ? item.subIssues : {};
        if (!isCount(done) || !isCount(total) || done > total) {
          errors.push(`${at}.subIssues must be { done, total } with done <= total`);
        }
      }
      if (item.prs !== undefined && !isCount(item.prs)) {
        errors.push(`${at}.prs must be a non-negative integer`);
      }
      if (item.people !== undefined && (!Array.isArray(item.people) || !item.people.every(p => typeof p === 'string' && p))) {
        errors.push(`${at}.people must be an array of GitHub logins`);
      }
    });
  };

  validateItems(report.shipped, 'shipped');

  if (isObject(scope)) {
    for (const key of ['inProgress', 'next']) {
      if (scope.inProgress === true) {
        validateItems(report[key], key);
      } else if (report[key] !== undefined) {
        errors.push(`${key} must be omitted when scope.inProgress is false`);
      }
    }
    if (scope.offBoard === true) {
      if (!Array.isArray(report.misc)) {
        errors.push('misc must be an array when scope.offBoard is true');
      } else {
        report.misc.forEach((entry, i) => {
          const at = `misc[${i}]`;
          if (!isObject(entry)) {
            errors.push(`${at} must be an object`);
            return;
          }
          requireString(entry.title, `${at}.title`);
          if (entry.url !== undefined) {
            requireString(entry.url, `${at}.url`);
          }
          if (entry.kind !== 'fix' && entry.kind !== 'improvement') {
            errors.push(`${at}.kind must be "fix" or "improvement"`);
          }
        });
      }
    } else if (report.misc !== undefined) {
      errors.push('misc must be omitted when scope.offBoard is false');
    }
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Formatting helpers

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Escapes text and turns owner/repo#123 references into GitHub links.
export function richText(text) {
  return escapeHtml(text).replace(
    /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g,
    (match, owner, repo, number) => `<a href="https://github.com/${owner}/${repo}/issues/${number}">${match}</a>`,
  );
}

function parseDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}

export function formatDate(iso, referenceYear) {
  const { year, month, day } = parseDate(iso);
  const short = `${MONTHS[month - 1]} ${day}`;
  return year === referenceYear ? short : `${short}, ${year}`;
}

function formatRange(start, end, referenceYear) {
  if (start && end) {
    return `${formatDate(start, referenceYear)} → ${formatDate(end, referenceYear)}`;
  }
  if (start) {
    return `Started ${formatDate(start, referenceYear)}`;
  }
  return end ? `Completed ${formatDate(end, referenceYear)}` : null;
}

// "#123" for the main tracker, "opencollective-api#123" elsewhere.
export function shortRef(url) {
  const match = /github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/.exec(url ?? '');
  if (!match) {
    return '';
  }
  const [, owner, repo, number] = match;
  if (owner === 'opencollective' && repo === 'opencollective') {
    return `#${number}`;
  }
  return owner === 'opencollective' ? `${repo}#${number}` : `${owner}/${repo}#${number}`;
}

function repoLabel(url) {
  const match = /github\.com\/[^/]+\/([^/]+)\//.exec(url ?? '');
  return match ? match[1].replace(/^opencollective-/, '') : null;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function areaFamily(area) {
  return AREA_FAMILY.get(area) ?? 'other';
}

function areaPill(area) {
  return `<span class="pill area-${areaFamily(area)}">${escapeHtml(area)}</span>`;
}

function peopleList(people) {
  return people?.length ? people.map(login => `@${escapeHtml(login)}`).join(', ') : null;
}

// ---------------------------------------------------------------------------
// Sections

function renderHeader(report) {
  const { period, scope } = report;
  const year = parseDate(period.end).year;
  const chips = ['Shipped work'];
  if (scope.inProgress) {
    chips.push('In progress & next');
  }
  if (scope.offBoard) {
    chips.push('Work outside the board');
  }
  return `
  <header class="report-header">
    <div>
      <p class="eyebrow"><span class="eyebrow-mark" aria-hidden="true"></span>Open Collective engineering</p>
      <h1>Engineering report: ${escapeHtml(period.label)}</h1>
      <p class="period">${formatDate(period.start, year)} – ${formatDate(period.end, null)} · Generated ${formatDate(report.generatedOn, year)}</p>
    </div>
    <div class="chips" aria-label="Included in this report">
      ${chips.map(chip => `<span class="chip"><span class="chip-dot" aria-hidden="true"></span>${chip}</span>`).join('')}
    </div>
  </header>`;
}

function renderTile(label, value, previous, previousLabel) {
  let delta = '';
  let previousLine = '';
  if (previous !== undefined) {
    if (previous > 0) {
      const change = Math.round(((value - previous) / previous) * 100);
      const rotation = change > 0 ? -45 : change < 0 ? 45 : 0;
      const arrow = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="transform:rotate(${rotation}deg)"><path d="M2 6h8M7 3l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const sign = change > 0 ? '+' : change < 0 ? '−' : '';
      delta = `<span class="delta" title="Change vs ${escapeHtml(previousLabel)}">${arrow}${sign}${Math.abs(change)}%</span>`;
    }
    previousLine = `<p class="tile-previous">${previous.toLocaleString('en-US')} in ${escapeHtml(previousLabel)}</p>`;
  }
  return `
    <div class="tile">
      <p class="tile-label">${label}</p>
      <p class="tile-value">${value.toLocaleString('en-US')}${delta}</p>
      ${previousLine}
    </div>`;
}

function renderStats(report) {
  const { metrics } = report;
  return `
  <section class="stats" aria-label="Key numbers">
    ${renderTile('Projects shipped', report.shipped.length, metrics.shippedPrevious, metrics.previousLabel)}
    ${renderTile('Pull requests merged', metrics.prsMerged.value, metrics.prsMerged.previous, metrics.previousLabel)}
    ${renderTile('Issues closed', metrics.issuesClosed.value, metrics.issuesClosed.previous, metrics.previousLabel)}
    ${renderTile('Contributors', metrics.contributors.value, metrics.contributors.previous, metrics.previousLabel)}
  </section>`;
}

function sectionTitle(title, count) {
  const badge = count === undefined ? '' : `<span class="count">${count}</span>`;
  return `<h2 class="section-title">${title}${badge}</h2>`;
}

function renderSummary(report) {
  return `
  <section class="section">
    ${sectionTitle('Highlights')}
    <div class="summary">${report.summary.map(p => `<p>${richText(p)}</p>`).join('')}</div>
  </section>`;
}

function renderCard(item, year) {
  const meta = [
    formatRange(item.start, item.end, year),
    item.subIssues?.total ? `${item.subIssues.done}/${plural(item.subIssues.total, 'sub-issue')}` : null,
    item.prs ? plural(item.prs, 'PR') : null,
    peopleList(item.people),
  ].filter(Boolean);
  return `
        <article class="card card-tinted area-${areaFamily(item.area)}">
          ${areaPill(item.area)}
          <h3 class="card-title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a><span class="ref">${shortRef(item.url)}</span></h3>
          ${item.summary ? `<p class="card-summary">${richText(item.summary)}</p>` : ''}
          ${meta.length ? `<ul class="meta">${meta.map(m => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
        </article>`;
}

// Stable order: board area order, then title.
function sortByArea(items) {
  const rank = area => AREA_ORDER.get(area) ?? AREAS.length;
  return [...items].sort((a, b) => rank(a.area) - rank(b.area) || a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
}

function renderShipped(report) {
  const year = parseDate(report.period.end).year;
  const body = report.shipped.length
    ? `<div class="cards">${sortByArea(report.shipped)
        .map(item => renderCard(item, year))
        .join('')}
    </div>`
    : '<p class="empty">No board project was completed during this period.</p>';
  return `
  <section class="section" id="shipped">
    ${sectionTitle('Shipped', report.shipped.length)}
    ${body}
  </section>`;
}

function renderRow(item, year, withProgress) {
  const facts = [
    withProgress ? formatRange(item.start, null, year) : null,
    item.prs ? plural(item.prs, 'PR') + ' this period' : null,
    peopleList(item.people),
  ].filter(Boolean);
  let side = '';
  if (withProgress && item.subIssues?.total) {
    const percent = Math.round((item.subIssues.done / item.subIssues.total) * 100);
    side = `
        <div class="row-side">${item.subIssues.done} of ${plural(item.subIssues.total, 'sub-issue')} done
          <div class="meter" role="img" aria-label="${percent}% of sub-issues done"><div class="meter-fill" style="width:${percent}%"></div></div>
        </div>`;
  }
  return `
      <li class="row">
        <div class="row-main">
          <div class="row-head">${areaPill(item.area)}<h3 class="card-title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a><span class="ref">${shortRef(item.url)}</span></h3></div>
          ${item.summary ? `<p class="card-summary">${richText(item.summary)}</p>` : ''}
          ${facts.length ? `<ul class="meta">${facts.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
        </div>${side || '<div></div>'}
      </li>`;
}

function renderRowSection(id, title, intro, items, empty, year, withProgress) {
  const body = items.length
    ? `<ul class="rows">${sortByArea(items).map(item => renderRow(item, year, withProgress)).join('')}
    </ul>`
    : `<p class="empty">${empty}</p>`;
  return `
  <section class="section" id="${id}">
    ${sectionTitle(title, items.length)}
    <p class="section-intro">${intro}</p>
    ${body}
  </section>`;
}

function renderMisc(report) {
  const column = (title, kind) => {
    const entries = report.misc.filter(entry => entry.kind === kind);
    const list = entries.length
      ? `<ul>${entries
          .map(entry => {
            const label = entry.url ? `<a href="${escapeHtml(entry.url)}">${escapeHtml(entry.title)}</a>` : escapeHtml(entry.title);
            const repo = repoLabel(entry.url);
            return `<li>${label}${repo ? ` <span class="repo">${escapeHtml(repo)}</span>` : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="section-intro">None this period.</p>';
    return `<div class="misc-col"><h3>${title}</h3>${list}</div>`;
  };
  return `
  <section class="section" id="misc">
    ${sectionTitle('Misc fixes and improvements', report.misc.length)}
    <p class="section-intro">Smaller changes merged during the period that are not part of a board project.</p>
    <div class="misc">${column('Fixes', 'fix')}${column('Improvements', 'improvement')}</div>
  </section>`;
}

function renderFooter(report) {
  const { scope } = report;
  const repos = scope.repos.map(repo => `<a href="https://github.com/${escapeHtml(repo)}">${escapeHtml(repo)}</a>`).join(', ');
  const included = [
    'projects completed on the board',
    scope.inProgress ? 'current work in progress and upcoming priorities' : null,
    scope.offBoard ? 'smaller work merged outside the board' : null,
  ].filter(Boolean);
  return `
  <footer class="report-footer">
    <p>Built from the <a href="${BOARD_URL}">Engineering Board</a>. Includes ${included.join(', ')}.</p>
    <p>Numbers cover pull requests merged in ${repos}, excluding automated dependency updates, and issues closed as completed in <a href="https://github.com/opencollective/opencollective">opencollective/opencollective</a>.</p>
  </footer>`;
}

export function renderReport(report, css = readFileSync(join(ASSETS, 'style.css'), 'utf8')) {
  const year = parseDate(report.period.end).year;
  const sections = [renderHeader(report), renderStats(report), renderSummary(report), renderShipped(report)];
  if (report.scope.inProgress) {
    sections.push(
      renderRowSection('in-progress', 'In progress', 'Board projects being worked on at the end of the period.', report.inProgress, 'Nothing is in progress on the board.', year, true),
      renderRowSection('next', 'Up next', 'Priorities queued to start next.', report.next, 'No priorities are queued on the board.', year, false),
    );
  }
  if (report.scope.offBoard) {
    sections.push(renderMisc(report));
  }
  sections.push(renderFooter(report));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Engineering report: ${escapeHtml(report.period.label)}</title>
<style>
${css}</style>
</head>
<body>
<main class="report">${sections.join('\n')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// CLI

function main([input, output]) {
  if (!input) {
    console.error('Usage: node build-report.mjs <report.json> [out.html]');
    process.exit(2);
  }
  const inputPath = resolve(input);
  const outputPath = resolve(output ?? join(dirname(inputPath), 'report.html'));
  let report;
  try {
    report = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${inputPath}: ${error.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validateReport(report);
  warnings.forEach(warning => console.error(`warning: ${warning}`));
  if (errors.length) {
    console.error(`${inputPath} is invalid:`);
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  writeFileSync(outputPath, renderReport(report));
  console.log(`Wrote ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
